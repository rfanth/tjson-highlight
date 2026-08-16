// Parse errors as editor diagnostics.
//
// The parser stops at the first fault and does not recover, so one diagnostic
// per document is not a reduced view -- it is everything there is to report.
// That is why this needs no language server: there is no incremental state to
// keep, so a whole-document parse on a change is the same work a server would
// do, without the process or the protocol.

const vscode = require("vscode");
const preview = require("./preview");

// vendor/ is the published @rfanth/tjson WebAssembly build, pulled by
// scripts/pull-wasm.mjs. It is the same artifact anyone can `npm i`, which is
// what makes a diagnostic reported here reproducible outside the editor.
//
// Wasm rather than a native binary because it is one file for Linux, macOS and
// Windows alike, and nothing has to be downloaded on first run. It is an ES
// module, so it arrives through a dynamic import — which also keeps activation
// off the critical path, since instantiating the module is the slow part and
// nothing needs it until a .tjson document is actually open.
let loading = null;
let loadFailureReported = false;
function parser() {
  if (loading === null) {
    loading = import("../vendor/index.js");
  }
  return loading;
}

// "line 4, column 23: the rest of the message"
const LOCATION = /^(?:.*?: )?line (\d+), column (\d+): ([\s\S]*)$/;

/** Turn a thrown parse error into a diagnostic, or null if it carries no position. */
function toDiagnostic(lines, error) {
  const message = String((error && error.message) || error);
  const found = LOCATION.exec(message);
  if (!found) {
    return null;
  }

  // Lines rather than a TextDocument, because the text being reported on is not
  // always a document the editor has: a preview is rendered by this extension
  // and handed here directly, before the editor has anything to look at.
  //
  // The parser counts from 1, the editor from 0.
  const lineNumber = Math.max(Math.min(Number(found[1]) - 1, lines.length - 1), 0);
  const text = lines[lineNumber] ?? "";
  const column = Math.max(Number(found[2]) - 1, 0);

  // Underline from the fault to the end of the line rather than a single
  // character: the column is where parsing stopped, and what went wrong is
  // usually the run that starts there. A one-character squiggle on a space --
  // which is a real fault in this format -- would be invisible.
  const start = Math.min(column, text.length);
  const end = Math.max(text.length, start + 1);
  const range = new vscode.Range(lineNumber, start, lineNumber, end);

  const diagnostic = new vscode.Diagnostic(range, found[3], vscode.DiagnosticSeverity.Error);
  diagnostic.source = "tjson";
  return diagnostic;
}

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection("tjson");
  context.subscriptions.push(diagnostics);

  // Report on text, named by the uri it belongs to, rather than on a document.
  //
  // A preview is not a file the editor is watching: its content comes from this
  // extension, and the editor replaces it by asking the content provider again.
  // Reporting on a document means waiting for an edit notification about that
  // replacement, which is a promise nobody here made -- so the preview passes
  // its text in directly and the report never depends on being told twice.
  //
  // `null` means there is nothing to say about that uri, which is not the same
  // as saying it is clean: it is what a preview showing an explanatory note
  // uses, since a note is not TJSON and parsing it would only report that.
  const report = async (uri, text) => {
    if (text === null) {
      diagnostics.delete(uri);
      return;
    }

    let tjson;
    try {
      tjson = await parser();
    } catch (error) {
      // The parser failing to load is not a fault in the document, so it must
      // not turn into a squiggle on one. It is also not something the writer
      // can act on, and silence would leave the extension looking like it
      // simply approves of everything -- so say it, plainly, and once. The
      // load is cached, so it fails identically on every keystroke; without
      // the latch that is a dialog per keystroke.
      if (!loadFailureReported) {
        loadFailureReported = true;
        vscode.window.showErrorMessage(
          `TJSON: could not load the parser in vendor/, so no errors will be reported. ${error}`
        );
      }
      return;
    }

    try {
      tjson.parse(text);
      diagnostics.delete(uri);
    } catch (error) {
      const diagnostic = toDiagnostic(text.split(/\r?\n/), error);
      diagnostics.set(uri, diagnostic ? [diagnostic] : []);
    }
  };

  // The preview renders through this extension, so it reports its own result
  // rather than being watched for one.
  preview.register(context, parser, report);

  // Returns the report's promise: a caller that wants to know the document has
  // been checked has to have something to wait on.
  //
  // A preview is skipped, not because there is nothing to say about it, but
  // because it has already been said: the provider reports on the text at the
  // moment it produces it. Checking it again here would be a second opinion
  // formed without the one thing the provider knows -- whether the pane holds
  // rendered TJSON or an explanatory note -- so it would parse a note as a
  // document and report the only thing a page of `//` can be faulted for.
  const check = (document) => {
    if (document.uri.scheme === preview.SCHEME || document.languageId !== "tjson") {
      return Promise.resolve();
    }
    return report(document.uri, document.getText());
  };

  // Typing is debounced because a half-written line is nearly always invalid,
  // and reporting that on every keystroke would mean the squiggle spends most
  // of its life describing something the writer is in the middle of fixing.
  //
  // One timer per document, because a single shared one lets any document
  // cancel a check pending on another -- editing a file would call off the
  // check on whatever was edited a moment earlier, and that check never runs.
  const pending = new Map();
  const checkSoon = (document) => {
    const key = document.uri.toString();
    clearTimeout(pending.get(key));
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        check(document);
      }, 500)
    );
  };

  const forget = (document) => {
    const key = document.uri.toString();
    clearTimeout(pending.get(key));
    pending.delete(key);
    diagnostics.delete(document.uri);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(check),
    vscode.workspace.onDidSaveTextDocument(check),
    vscode.workspace.onDidChangeTextDocument((event) => checkSoon(event.document)),
    vscode.workspace.onDidCloseTextDocument(forget)
  );

  vscode.workspace.textDocuments.forEach(check);
}

function deactivate() {}

module.exports = { activate, deactivate };
