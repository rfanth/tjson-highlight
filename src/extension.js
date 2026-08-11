// Parse errors as editor diagnostics.
//
// The parser stops at the first fault and does not recover, so one diagnostic
// per document is not a reduced view -- it is everything there is to report.
// That is why this needs no language server: there is no incremental state to
// keep, so a whole-document parse on a change is the same work a server would
// do, without the process or the protocol.

const vscode = require("vscode");

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
function toDiagnostic(document, error) {
  const message = String((error && error.message) || error);
  const found = LOCATION.exec(message);
  if (!found) {
    return null;
  }

  // The parser counts from 1, the editor from 0.
  const lineNumber = Math.min(Number(found[1]) - 1, document.lineCount - 1);
  const line = document.lineAt(Math.max(lineNumber, 0));
  const column = Math.max(Number(found[2]) - 1, 0);

  // Underline from the fault to the end of the line rather than a single
  // character: the column is where parsing stopped, and what went wrong is
  // usually the run that starts there. A one-character squiggle on a space --
  // which is a real fault in this format -- would be invisible.
  const start = Math.min(column, line.text.length);
  const end = Math.max(line.range.end.character, start + 1);
  const range = new vscode.Range(line.lineNumber, start, line.lineNumber, end);

  const diagnostic = new vscode.Diagnostic(range, found[3], vscode.DiagnosticSeverity.Error);
  diagnostic.source = "tjson";
  return diagnostic;
}

function activate(context) {
  require("./preview").register(context, parser);

  const diagnostics = vscode.languages.createDiagnosticCollection("tjson");
  context.subscriptions.push(diagnostics);

  const check = async (document) => {
    if (document.languageId !== "tjson") {
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
      tjson.parse(document.getText());
      diagnostics.delete(document.uri);
    } catch (error) {
      const diagnostic = toDiagnostic(document, error);
      diagnostics.set(document.uri, diagnostic ? [diagnostic] : []);
    }
  };

  // Typing is debounced because a half-written line is nearly always invalid,
  // and reporting that on every keystroke would mean the squiggle spends most
  // of its life describing something the writer is in the middle of fixing.
  let pending = null;
  const checkSoon = (document) => {
    clearTimeout(pending);
    pending = setTimeout(() => check(document), 500);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(check),
    vscode.workspace.onDidSaveTextDocument(check),
    vscode.workspace.onDidChangeTextDocument((event) => checkSoon(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri))
  );

  vscode.workspace.textDocuments.forEach(check);
}

function deactivate() {}

module.exports = { activate, deactivate };
