#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("acorn");
const { SRC_DIR, relPath } = require("./patch-util");

const MARKER = "/* CodexRebuildWindowsTray */";

function patchWindowsTraySource(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const targets = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "NewExpression" && node.callee?.type === "MemberExpression" &&
        !node.callee.computed && node.callee.property.name === "Tray") targets.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  }
  walk(ast);
  if (targets.length !== 1) throw new Error(`Windows tray expected exactly 1 constructor, found ${targets.length}`);
  const target = targets[0];
  const [icon, guid] = target.arguments;
  if (icon?.type !== "MemberExpression" || icon.property.name !== "defaultIcon") {
    throw new Error("Windows tray default icon argument changed");
  }
  const call = source.slice(target.start, target.end);
  if (target.arguments.length === 1 && call.endsWith(`${MARKER})`)) {
    return { code: source, status: "already" };
  }
  const electron = source.slice(target.callee.object.start, target.callee.object.end);
  if (target.arguments.length !== 2 || guid?.type !== "ConditionalExpression" ||
      source.slice(guid.test.start, guid.test.end) !== `process.platform===\`win32\`&&${electron}.app.isPackaged` ||
      guid.consequent.type !== "CallExpression" || guid.consequent.callee.type !== "Identifier" ||
      source.slice(guid.alternate.start, guid.alternate.end) !== "void 0") {
    throw new Error("Windows tray GUID argument changed");
  }
  // Unsigned Squirrel executables move on update. Windows binds a fixed GUID
  // to the old EXE path, so use Electron's optional-GUID behavior instead.
  // https://www.electronjs.org/docs/latest/api/tray#new-trayimage-guid
  return {
    code: source.slice(0, icon.end) + MARKER + source.slice(target.end - 1),
    status: "patched",
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => ["unix", "mac-arm64", "mac-x64"].includes(arg))) return;
  const directory = path.join(SRC_DIR, "win", "_asar", ".vite", "build");
  if (!fs.existsSync(directory) && !args.includes("win")) return;
  const bundles = fs.readdirSync(directory).filter((name) => /^main-.*\.js$/.test(name));
  if (bundles.length !== 1) throw new Error("Windows tray main bundle is missing or ambiguous");
  const file = path.join(directory, bundles[0]);
  const result = patchWindowsTraySource(fs.readFileSync(file, "utf8"));
  if (!args.includes("--check") && result.status === "patched") fs.writeFileSync(file, result.code);
  console.log(`  [${args.includes("--check") ? "check" : result.status}] ${relPath(file)}: Windows tray without fixed GUID`);
}

if (require.main === module) main();
module.exports = { patchWindowsTraySource };
