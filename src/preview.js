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
    convert: (tjson, text) => tjson.toJson(text),
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

function register(context, parser) {
  const changed = new vscode.EventEmitter();

  const provider = {
    onDidChange: changed.event,
    async provideTextDocumentContent(uri) {
      const origin = previewOrigin(uri);
      if (!origin) {
        return "// TJSON preview: this preview has lost track of its source.\n";
      }

      let tjson;
      try {
        tjson = await parser();
      } catch (error) {
        return `// TJSON preview: the parser in vendor/ could not be loaded.\n// ${error}\n`;
      }

      try {
        const text = await sourceText(origin.source);
        return MODES[origin.mode].convert(tjson, text, renderOptions(context));
      } catch (error) {
        // Shown in the pane rather than only as a toast: the pane is where the
        // reader is looking, and an empty one with a notification that has
        // already faded explains nothing. Commented so it reads as a note about
        // the preview rather than as content.
        const detail = String(error && error.message ? error.message : error);
        return [
          "// TJSON preview: the source could not be converted.",
          ...detail.split("\n").map((line) => `// ${line}`),
          "",
        ].join("\n");
      }
    },
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider)
  );

  // Refresh open previews as their source is edited. Debounced for the same
  // reason the diagnostics are: a document mid-keystroke is usually not valid,
  // and re-rendering it on every character is work nobody sees.
  let pending = null;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const source = event.document.uri.toString();
      const open = vscode.workspace.textDocuments
        .filter((document) => document.uri.scheme === SCHEME)
        .filter((document) => previewOrigin(document.uri)?.source.toString() === source);

      if (open.length === 0) {
        return;
      }
      clearTimeout(pending);
      pending = setTimeout(() => {
        for (const document of open) {
          changed.fire(document.uri);
        }
      }, 500);
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
