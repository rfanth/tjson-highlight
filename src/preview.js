// Converting between JSON and TJSON, shown two ways.
//
// The preview is a virtual read-only document rather than a webview. A webview
// would mean shipping the TextMate engine and oniguruma's wasm inside the
// extension and re-implementing the scope-to-colour mapping, only to arrive at
// something the editor already does. A virtual document with `languageId` set
// gets highlighted by this extension's own grammar, in the reader's own theme,
// for nothing — and it is checked by this extension's own diagnostics, so a
// squiggle in a preview means the renderer emitted something the parser will
// not take. That is a free round-trip test running every time anyone looks.
//
// The editable variant exists because a preview cannot be saved or tweaked. It
// is a separate command rather than a mode, so neither has to explain itself.

const vscode = require("vscode");
const { renderOptions } = require("./render-options");
const { createPacer } = require("./debounce");

const SCHEME = "tjson-preview";

// Each mode says how to convert, and what the result should be called — the
// path extension is what tells VS Code which language to highlight it as.
const MODES = {
  toTjson: {
    title: "TJSON",
    extension: ".tjson",
    convert: (tjson, text, options) => tjson.fromJson(text, options),
  },
  toJson: {
    title: "JSON",
    extension: ".json",
    // toJsonPretty rather than toJson: minified JSON is correct output and
    // unreadable reading. Indenting it here in JavaScript was possible but
    // wrong -- the renderer holds every number as exact text, and any
    // JS-side reformat has to work to avoid putting them through an f64.
    // Asking the renderer for the indentation it already knows how to
    // produce removes the problem rather than handling it.
    convert: (tjson, text) => tjson.toJsonPretty(text),
  },
  reformat: {
    title: "reformatted",
    extension: ".tjson",
    // Through JSON and back: the renderer's input is data, not text, so this is
    // the only way to re-render a document that already exists. Comments do not
    // survive the round trip, which is why the command warns before doing it.
    convert: (tjson, text, options) => tjson.fromJson(tjson.toJson(text), options),
  },
};

/** Where a preview came from, so it can be refreshed and re-derived. */
function previewUri(source, mode) {
  const name = source.path.split("/").pop().replace(/\.[^.]*$/, "");
  const { title, extension } = MODES[mode];
  const label = mode === "toTjson" || mode === "toJson" ? name : `${name} (${title})`;
  return vscode.Uri.from({
    scheme: SCHEME,
    path: `/${label}${extension}`,
    query: JSON.stringify({ mode, source: source.toString() }),
  });
}

function previewOrigin(uri) {
  try {
    const { mode, source } = JSON.parse(uri.query);
    return MODES[mode] ? { mode, source: vscode.Uri.parse(source) } : null;
  } catch {
    return null;
  }
}

/** The source text, preferring the open buffer so unsaved edits are previewed. */
async function sourceText(uri) {
  const open = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString()
  );
  if (open) {
    return open.getText();
  }
  return (await vscode.workspace.openTextDocument(uri)).getText();
}

function register(context, parser, report, activity) {
  const changed = new vscode.EventEmitter();

  // Paces refreshes by what rendering has been costing. Separate from the
  // diagnostics' pacer: a reformat is a round trip through JSON and back, so
  // it costs about twice what checking the same document does, and one pooled
  // record would pace each of them by the other's work.
  const renders = createPacer();

  // What the pane is showing decides what may be said about it. Rendered TJSON
  // is checked, because a squiggle there means the renderer emitted something
  // the parser will not take -- the round-trip test this preview exists to be.
  // A note is not TJSON and gets nothing, since parsing a line of `//` prose
  // only ever reports that it is not a document, which is true and useless.
  //
  // Reported before the text is handed back, rather than alongside it: the
  // editor shows what this returns, so anything still owed at that moment is
  // owed against a pane the reader is already looking at. Waiting costs a
  // parse that was going to happen regardless, and buys the guarantee that no
  // squiggle ever outlives the line it was about.
  const note = async (uri, text) => {
    await report(uri, null);
    return text;
  };
  const rendered = async (uri, mode, text) => {
    await report(uri, MODES[mode].extension === ".tjson" ? text : null);
    return text;
  };

  const provider = {
    onDidChange: changed.event,
    async provideTextDocumentContent(uri) {
      const origin = previewOrigin(uri);
      if (!origin) {
        return await note(uri, "// TJSON preview: this preview has lost track of its source.\n");
      }

      let tjson;
      try {
        tjson = await parser();
      } catch (error) {
        activity.settled(`preview:${origin.source}`);
        return await note(
          uri,
          `// TJSON preview: the parser in vendor/ could not be loaded.\n// ${error}\n`
        );
      }

      // In a finally rather than beside each return: a pane that failed to
      // render is still a pane that has stopped working on it, and a cue left
      // spinning after an error is a worse lie than no cue at all.
      try {
        const text = await sourceText(origin.source);
        // Measured against the source, not this pane: the timer paced by it
        // is the one watching the source for changes.
        const converted = renders.measure(origin.source.toString(), () =>
          MODES[origin.mode].convert(tjson, text, renderOptions(context))
        );
        return await rendered(uri, origin.mode, converted);
      } catch (error) {
        // Shown in the pane rather than only as a toast: the pane is where the
        // reader is looking, and an empty one with a notification that has
        // already faded explains nothing. Commented so it reads as a note about
        // the preview rather than as content.
        const detail = String(error && error.message ? error.message : error);
        return await note(
          uri,
          [
            "// TJSON preview: the source could not be converted.",
            ...detail.split("\n").map((line) => `// ${line}`),
            "",
          ].join("\n")
        );
      } finally {
        activity.settled(`preview:${origin.source}`);
      }
    },
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider)
  );

  // Refresh open previews as their source is edited. Debounced for the same
  // reason the diagnostics are: a document mid-keystroke is usually not valid,
  // and re-rendering it on every character is work nobody sees.
  //
  // One timer per source. A single shared one means editing one file cancels a
  // refresh already owed to a preview of a different file, and that preview
  // then shows an older render than the one it was asked for.
  const pending = new Map();
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const source = event.document.uri.toString();
      const open = vscode.workspace.textDocuments
        .filter((document) => document.uri.scheme === SCHEME)
        .filter((document) => previewOrigin(document.uri)?.source.toString() === source);

      if (open.length === 0) {
        return;
      }
      const delay = renders.delayFor(source);
      activity.waiting(`preview:${source}`, delay, renders.costFor(source) ?? 0);
      clearTimeout(pending.get(source));
      pending.set(
        source,
        setTimeout(() => {
          pending.delete(source);
          for (const document of open) {
            changed.fire(document.uri);
          }
        }, delay)
      );
    })
  );

  const openPreview = async (mode) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    if (mode === "reformat") {
      // Round-tripping through JSON drops comments, and losing something a
      // person wrote should never be a surprise. Only warn when there is
      // actually something to lose.
      const hasComments = /^[ \t]*\/\//m.test(editor.document.getText());
      if (hasComments) {
        vscode.window.showWarningMessage(
          "TJSON: reformatting goes through JSON, which has no comments — the comments in this file will not appear in the result."
        );
      }
    }

    const uri = previewUri(editor.document.uri, mode);
    changed.fire(uri); // re-render rather than reuse a cached body
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: false,
      preserveFocus: true,
    });
  };

  const openAsFile = async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== SCHEME) {
      vscode.window.showInformationMessage(
        "TJSON: run this on a preview pane to get an editable copy of it."
      );
      return;
    }
    const origin = previewOrigin(editor.document.uri);
    const document = await vscode.workspace.openTextDocument({
      content: editor.document.getText(),
      language: origin && MODES[origin.mode].extension === ".json" ? "json" : "tjson",
    });
    await vscode.window.showTextDocument(document, { preview: false });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("tjson.preview.toTjson", () => openPreview("toTjson")),
    vscode.commands.registerCommand("tjson.preview.toJson", () => openPreview("toJson")),
    vscode.commands.registerCommand("tjson.preview.reformat", () => openPreview("reformat")),
    vscode.commands.registerCommand("tjson.openPreviewAsFile", openAsFile)
  );
}

module.exports = { register, SCHEME, MODES, previewUri, previewOrigin };
