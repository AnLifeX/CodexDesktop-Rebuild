#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { SRC_DIR, relPath } = require("./patch-util");

const ASSET = path.join(__dirname, "assets", "computer-use", "windows-cua-app-bindings.mjs");
const RUNTIME_ROOT = path.join(SRC_DIR, "win", "cua_node", "bin", "node_modules", "@oai", "cua");
const GLOBALS = path.join(RUNTIME_ROOT, "dist", "lib", "js", "oai_js_cua", "src", "tinysky_alt", "globals.js");
const IMPORT = 'import{installWindowsAppBindings}from"./windows_app_bindings.js";';
const LEGACY_ANCHOR = 'Reflect.set(globalThis,"cua",t({browsers:i,computer:l}));';
const LEGACY_REPLACEMENT = 'const a=t({browsers:i,computer:l});await installWindowsAppBindings(a);Reflect.set(globalThis,"cua",a);';
const SETUP_ASSIGNMENT = /Object\.assign\(([\w$]+),([\w$]+)\)(?=\}\)\),[\w$]+\})/;
const EAGER_ASSIGNMENT = /Object\.assign\(([\w$]+),\{initialize:\1\.getState\}\),Reflect\.set\(globalThis,"cua",\1\);/;

function patchGlobalsSource(source) {
  if (source.includes('from"./windows_app_bindings.js"')) return source;
  const imported = source.replace('from"./create_tinysky_alt.js";', 'from"./create_tinysky_alt.js";' + IMPORT);
  if (imported === source) throw new Error("Unified CUA globals import changed");
  const eager = imported.replace(
    EAGER_ASSIGNMENT,
    "Object.assign($1,{initialize:$1.getState});await installWindowsAppBindings($1);Reflect.set(globalThis,\"cua\",$1);",
  );
  if (eager !== imported) return eager;
  if (imported.includes(LEGACY_ANCHOR)) return imported.replace(LEGACY_ANCHOR, LEGACY_REPLACEMENT);
  const patched = imported.replace(
    SETUP_ASSIGNMENT,
    "Object.assign($1,$2);return installWindowsAppBindings($1)",
  );
  if (patched === imported) throw new Error("Unified CUA globals setup changed");
  return patched;
}

function installWindowsCuaBindings(runtimeRoot = RUNTIME_ROOT) {
  const globals = path.join(runtimeRoot, "dist", "lib", "js", "oai_js_cua", "src", "tinysky_alt", "globals.js");
  if (!fs.existsSync(globals)) throw new Error(`Unified CUA globals are missing: ${globals}`);
  const original = fs.readFileSync(globals, "utf8");
  const patched = patchGlobalsSource(original);
  fs.writeFileSync(globals, patched);
  const bindings = path.join(path.dirname(globals), "windows_app_bindings.js");
  fs.copyFileSync(ASSET, bindings);
  return { changed: original !== patched, globals, bindings };
}

function main() {
  const platform = process.argv.slice(2).find((arg) => ["mac-arm64", "mac-x64", "win", "unix"].includes(arg));
  if (platform && platform !== "win") return;
  const result = installWindowsCuaBindings();
  console.log(`  [ok] ${relPath(result.globals)}: ${result.changed ? "installed" : "refreshed"} Windows CUA app bindings`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`[x] ${error.message}`); process.exitCode = 1; }
}

module.exports = { ASSET, RUNTIME_ROOT, patchGlobalsSource, installWindowsCuaBindings };
