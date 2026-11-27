#!/usr/bin/env node
/**
 * Keep server-rendered usage text in the UI language.
 *
 * The sidebar usage menu ("Usage source", "5-hour limit", "% left", ...) is
 * rendered from strings the backend returns in /wham/usage, localized by the
 * request's OAI-Language header. When Statsig enables the "celcius_push"
 * transport, later refreshes arrive as pushed usage snapshots that do not
 * follow the current UI language and replace the localized response, so the
 * menu falls back to English after the first automatic refresh.
 *
 * Pin the transport to polling (the upstream default for accounts without the
 * push experiment). Every refresh is then a /wham/usage request carrying the
 * current OAI-Language, and upstream already refetches when the locale changes.
 */
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("acorn");
const { relPath, SRC_DIR, listJavaScriptFiles } = require("./patch-util");

const PUSH_TRANSPORT = "celcius_push";
const MARKER = "/* CodexRebuildUsagePolling */";

function walk(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (node.type) visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end") continue;
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) walk(child, visitor);
    } else if (value?.type) {
      walk(value, visitor);
    }
  }
}

function isString(node, value) {
  return node?.type === "Literal" && node.value === value;
}

// "celcius_push"===<layer>.get("transport","polling")?"push":"polling"
function isPushTransportSwitch(node) {
  if (node.type !== "ConditionalExpression") return false;
  const { test } = node;
  if (test?.type !== "BinaryExpression" || test.operator !== "===") return false;
  const [literal, call] = isString(test.left, PUSH_TRANSPORT)
    ? [test.left, test.right]
    : [test.right, test.left];
  if (!isString(literal, PUSH_TRANSPORT)) return false;
  if (
    call?.type !== "CallExpression" ||
    call.callee?.type !== "MemberExpression" ||
    call.callee.computed ||
    call.callee.property?.name !== "get" ||
    call.arguments.length !== 2 ||
    !isString(call.arguments[0], "transport")
  ) {
    return false;
  }
  return isString(node.consequent, "push") && isString(node.alternate, "polling");
}

function patchUsageTransportSource(source) {
  const already = source.split(MARKER).length - 1;
  const matches = [];
  if (source.includes(PUSH_TRANSPORT)) {
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    walk(ast, (node) => {
      if (isPushTransportSwitch(node)) matches.push(node);
    });
  }
  let code = source;
  for (const node of [...matches].sort((a, b) => b.start - a.start)) {
    code = code.slice(0, node.start) + `${MARKER}"polling"` + code.slice(node.end);
  }
  return { code, patched: matches.length, already };
}

function locateTargets(platform, sourceDir = SRC_DIR) {
  const assetsDir = path.join(sourceDir, platform, "_asar", "webview", "assets");
  if (!fs.existsSync(assetsDir)) throw new Error(`Webview assets are missing: ${assetsDir}`);
  const targets = [];
  for (const file of listJavaScriptFiles(assetsDir)) {
    const filePath = path.join(assetsDir, file);
    const source = fs.readFileSync(filePath, "utf8");
    if (!source.includes(PUSH_TRANSPORT) && !source.includes(MARKER)) continue;
    const result = patchUsageTransportSource(source);
    if (result.patched + result.already > 0) targets.push({ path: filePath, source, result });
  }
  const total = targets.reduce((sum, { result }) => sum + result.patched + result.already, 0);
  if (total !== 1) {
    throw new Error(`usage push transport switch expected exactly 1 target for ${platform}, found ${total}`);
  }
  return targets;
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((value) => ["mac-arm64", "mac-x64", "win", "unix"].includes(value));
  const platforms = platform === "unix"
    ? ["mac-arm64", "mac-x64"]
    : platform
      ? [platform]
      : ["mac-arm64", "mac-x64", "win"].filter((name) =>
          fs.existsSync(path.join(SRC_DIR, name, "_asar", "webview", "assets")));
  for (const name of platforms) {
    for (const target of locateTargets(name)) {
      if (target.result.patched === 0) {
        console.log(`  [ok] [${name}] ${relPath(target.path)}: usage refresh already pinned to polling`);
        continue;
      }
      if (!isCheck) fs.writeFileSync(target.path, target.result.code, "utf8");
      console.log(`  [${isCheck ? "check" : "ok"}] [${name}] ${relPath(target.path)}: usage refresh pinned to localized polling`);
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[x] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { MARKER, locateTargets, patchUsageTransportSource };
