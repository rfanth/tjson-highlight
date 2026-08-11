// Turning `tjson.render.*` settings into an options object for the renderer.
//
// The whole point of this file is what it refuses to do. VS Code's
// `getConfiguration().get()` always answers with something — if a setting is
// untouched it hands back the declared default. Forwarding that would pin the
// renderer to whatever this extension's package.json happened to say, so a
// later TJSON release changing one of its own defaults would never reach anyone
// who had ever opened the settings UI. The new behaviour would be silently
// overridden by a stale copy of the old one.
//
// So this reads through `inspect()` and takes only values a user actually set,
// at whatever scope they set them. A setting nobody touched is left out of the
// object entirely, and the library decides. That is also why every setting is
// declared with a `null` default rather than a real one — see
// scripts/gen-settings.mjs.

const vscode = require("vscode");

const PREFIX = "tjson.render.";

/**
 * The render options the user has explicitly chosen, and only those.
 *
 * @param {import("vscode").ExtensionContext} context
 * @returns {Record<string, unknown>} suitable for passing straight to fromJson
 */
function renderOptions(context) {
  // The key list comes from the extension's own manifest rather than a copy
  // kept here. scripts/gen-settings.mjs regenerates that manifest section from
  // the vendored library's type definitions on every parser pull, so options
  // added upstream become settings without anyone editing this file, and a
  // second list here could only ever fall behind the first.
  const declared = Object.keys(
    context.extension?.packageJSON?.contributes?.configuration?.properties ?? {}
  );

  const config = vscode.workspace.getConfiguration();
  const options = {};

  for (const key of declared) {
    if (!key.startsWith(PREFIX)) {
      continue;
    }

    const found = config.inspect(key);
    if (!found) {
      continue;
    }

    // Narrowest scope first, and `defaultValue` deliberately absent from the
    // chain. `null` reads as "not set" at every scope, which is what makes the
    // null-defaulted declaration mean what it looks like: falling through a
    // null to a wider scope is the behaviour a user expects from a cleared box.
    const chosen =
      found.workspaceFolderValue ?? found.workspaceValue ?? found.globalValue;

    if (chosen !== undefined && chosen !== null) {
      options[key.slice(PREFIX.length)] = chosen;
    }
  }

  return options;
}

module.exports = { renderOptions, PREFIX };
