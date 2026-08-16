// Saying so when the wait is long enough to look like a fault.
//
// The pacer spaces whole-document work by what that work costs, so on a large
// document or a slow machine the gap between typing and a squiggle moving can
// reach tens of seconds. That is the correct behaviour -- the alternative is
// an editor that spends its life converting -- but correct and silent is
// indistinguishable from broken. Somebody watching an error that will not
// clear has no way to tell a deliberate wait from a dead extension, and the
// natural conclusion is the unflattering one.
//
// Only above a threshold. A cue on a 300ms wait is noise, and noise on every
// keystroke teaches people to stop reading the status bar at all. Below the
// threshold the wait is short enough that nobody has time to wonder.
//
// The spinner keeps turning through the conversion itself even though that
// blocks the extension host: the animation belongs to the window, which is a
// different process, and the message reaches it before the blocking call
// starts. So the cue covers the whole span -- the wait and the work.

const vscode = require("vscode");

/** Below this, a wait is too short to be worth remarking on. */
const VISIBLE_ABOVE_MS = 2000;

/**
 * A status bar cue, shown while slow work is outstanding.
 *
 * Keyed, because the diagnostics and the preview both wait independently and
 * a document may be waiting on one while the other has finished. The cue is
 * shown while any key is outstanding and hidden when the last one settles.
 */
function createActivity() {
  const outstanding = new Set();
  let item = null;

  const refresh = () => {
    if (item === null) {
      return;
    }
    if (outstanding.size === 0) {
      item.hide();
      return;
    }
    item.show();
  };

  return {
    /** Build the status bar item. Owned by the caller's subscriptions. */
    register(context) {
      item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
      item.name = "TJSON";
      context.subscriptions.push(item);
      return item;
    },

    /**
     * Note that `key` is waiting `delay` ms before its work runs.
     *
     * Silent below the threshold, and a short wait that follows a long one
     * still clears the cue -- the document got faster, and the cue describes
     * now rather than what was true a moment ago.
     */
    waiting(key, delay, cost) {
      if (delay < VISIBLE_ABOVE_MS) {
        outstanding.delete(key);
        refresh();
        return;
      }
      outstanding.add(key);
      if (item !== null) {
        item.text = "$(sync~spin) TJSON";
        item.tooltip =
          `Checking this document takes about ${Math.round(cost)}ms, so TJSON spaces ` +
          `its checks ${(delay / 1000).toFixed(1)}s apart to keep the editor responsive. ` +
          `Errors and previews will lag the text by about that much.`;
      }
      refresh();
    },

    /** Note that `key`'s work has finished. */
    settled(key) {
      outstanding.delete(key);
      refresh();
    },
  };
}

module.exports = { createActivity, VISIBLE_ABOVE_MS };
