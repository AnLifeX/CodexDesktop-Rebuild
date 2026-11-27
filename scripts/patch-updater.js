#!/usr/bin/env node
/**
 * patch-updater.js — Disable Sparkle (macOS) and Windows auto-updater
 *
 * AST match: in the file containing shouldIncludeSparkle / shouldIncludeUpdater,
 * find these method definitions and replace their bodies to return false.
 *
 * Specifically targets:
 *   shouldIncludeSparkle(e,t,n){return ...}  → return !1
 *   shouldIncludeWindowsUpdater(e,t,n){return ...}  → return !1
 *   shouldIncludeUpdater(e,t,n){return ...}  → return !1
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("acorn");
const { SRC_DIR } = require("./patch-util");

const UPDATER_METHODS = new Set([
  "shouldIncludeSparkle",
  "shouldIncludeWindowsUpdater",
  "shouldIncludeWindowsMsixUpdater",
  "shouldIncludeUpdater",
]);

function walk(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (node.type) visitor(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child)
        if (item && typeof item === "object" && item.type) walk(item, visitor);
    } else if (child && typeof child === "object" && child.type) {
      walk(child, visitor);
    }
  }
}

function collectPatches(ast, source) {
  const patches = [];

  walk(ast, (node) => {
    // Match: Property with key being an updater method name and value being a FunctionExpression
    if (node.type !== "Property") return;
    const keyName = node.key?.name || node.key?.value;
    if (!UPDATER_METHODS.has(keyName)) return;

    const fn = node.value;
    if (fn?.type !== "FunctionExpression") return;
    const body = fn.body;
    if (!body || body.type !== "BlockStatement") return;
    if (body.body.length !== 1) return;
    const ret = body.body[0];
    if (ret.type !== "ReturnStatement" || !ret.argument) return;

    const retSrc = source.slice(ret.argument.start, ret.argument.end);
    if (retSrc === "!1") return;

    patches.push({
      id: keyName,
      start: ret.argument.start,
      end: ret.argument.end,
      replacement: "!1",
      original: retSrc.length > 50 ? retSrc.slice(0, 47) + "..." : retSrc,
    });
  });

  return patches;
}

function patchUpdaterSource(source) {
  let ast;
  try {
    ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  } catch (error) {
    throw new Error(`updater parse failed: ${error.message}`);
  }
  const targets = new Map([...UPDATER_METHODS].map((method) => [method, []]));
  walk(ast, (node) => {
    if (node.type !== "Property") return;
    const method = node.key?.name ?? node.key?.value;
    if (!targets.has(method)) return;
    if (node.value?.type === "ArrowFunctionExpression" && node.value.body.type !== "BlockStatement") {
      targets.get(method).push(node.value.body);
      return;
    }
    const body = ["FunctionExpression", "ArrowFunctionExpression"].includes(node.value?.type) ? node.value.body : null;
    if (body?.type !== "BlockStatement" || body.body.length !== 1) return;
    const returned = body.body[0];
    if (returned.type !== "ReturnStatement" || !returned.argument) return;
    targets.get(method).push(returned.argument);
  });

  const patches = [];
  const methods = {};
  let already = 0;
  for (const method of UPDATER_METHODS) {
    const matches = targets.get(method);
    if (matches.length !== 1) {
      throw new Error(`${method} expected exactly 1 target, found ${matches.length}`);
    }
    const argument = matches[0];
    const original = source.slice(argument.start, argument.end);
    const isAlready = original === "!1";
    if (isAlready) already += 1;
    else {
      patches.push({
        id: method,
        start: argument.start,
        end: argument.end,
        original,
        replacement: "!1",
      });
    }
    methods[method] = { patchable: isAlready ? 0 : 1, already: isAlready ? 1 : 0, total: 1 };
  }
  let code = source;
  for (const patch of [...patches].sort((left, right) => right.start - left.start)) {
    code = code.slice(0, patch.start) + patch.replacement + code.slice(patch.end);
  }
  return {
    code,
    status: patches.length > 0 ? "patched" : "already",
    patches,
    counts: {
      patchable: patches.length,
      already,
      total: patches.length + already,
      methods,
    },
  };
}

function patchUpdaterContracts({ loggerSource, workerSource }) {
  if (typeof loggerSource !== "string") throw new Error("updater logger source is required");
  if (typeof workerSource !== "string") throw new Error("updater worker source is required");
  const logger = patchUpdaterSource(loggerSource);
  const worker = patchUpdaterSource(workerSource);
  return {
    status: logger.status === "already" && worker.status === "already" ? "already" : "patched",
    logger,
    worker,
    counts: {
      patchable: logger.counts.patchable + worker.counts.patchable,
      already: logger.counts.already + worker.counts.already,
      total: logger.counts.total + worker.counts.total,
    },
  };
}

function locateTargets(buildDir) {
  return fs.readdirSync(buildDir).filter((name) => {
    if (!name.endsWith(".js")) return false;
    const source = fs.readFileSync(path.join(buildDir, name), "utf-8");
    if (!source.includes("shouldIncludeSparkle")) return false;
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    let found = false;
    walk(ast, (node) => {
      if (
        node.type === "Property" &&
        (node.key?.name ?? node.key?.value) === "shouldIncludeSparkle" &&
        ["FunctionExpression", "ArrowFunctionExpression"].includes(node.value?.type)
      ) found = true;
    });
    return found;
  });
}

// Upstream can bundle the build-flavor policy into several main-process
// entries (early-bootstrap, app-server-host, ...). Every copy outside the
// worker must be disabled; the worker copy is still required exactly once.
function planBuildDir(buildDir, platformName = path.basename(buildDir)) {
  const files = locateTargets(buildDir);
  const loggerNames = files.filter((name) => name !== "worker.js");
  const workerNames = files.filter((name) => name === "worker.js");
  if (loggerNames.length === 0) {
    throw new Error(`updater logger expected at least 1 target for ${platformName}, found 0`);
  }
  if (workerNames.length !== 1) {
    throw new Error(`updater worker expected exactly 1 target for ${platformName}, found ${workerNames.length}`);
  }
  const workerPath = path.join(buildDir, workerNames[0]);
  const workerSource = fs.readFileSync(workerPath, "utf-8");
  const targets = loggerNames.map((name) => {
    const loggerPath = path.join(buildDir, name);
    const loggerSource = fs.readFileSync(loggerPath, "utf-8");
    return { name, loggerPath, loggerSource, result: patchUpdaterContracts({ loggerSource, workerSource }) };
  });
  const writes = targets.map(({ loggerPath, loggerSource, result }) => ({ path: loggerPath, before: loggerSource, after: result.logger.code }));
  writes.push({ path: workerPath, before: workerSource, after: targets[0].result.worker.code });
  const worker = targets[0].result.worker.counts;
  const counts = targets.reduce(
    (sum, { result }) => ({
      patchable: sum.patchable + result.logger.counts.patchable,
      already: sum.already + result.logger.counts.already,
      total: sum.total + result.logger.counts.total,
    }),
    { patchable: worker.patchable, already: worker.already, total: worker.total },
  );
  return { platform: platformName, files: [...loggerNames, workerNames[0]], writes, counts };
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((a) => ["mac-arm64", "mac-x64", "win"].includes(a));
  const platforms = platform
    ? [platform]
    : ["mac-arm64", "mac-x64", "win"].filter((name) =>
        fs.existsSync(path.join(SRC_DIR, name, "_asar", ".vite", "build")),
      );
  if (platforms.length === 0) throw new Error("updater expected at least one platform");
  const plans = platforms.map((platformName) =>
    planBuildDir(path.join(SRC_DIR, platformName, "_asar", ".vite", "build"), platformName),
  );
  for (const plan of plans) {
    const status = isCheck ? "check" : plan.counts.patchable > 0 ? "patched" : "already";
    console.log(`  [${plan.platform}] ${status}: patchable=${plan.counts.patchable} already=${plan.counts.already} expected=${plan.counts.total} (${plan.files.join(", ")})`);
  }
  if (!isCheck) {
    for (const plan of plans) {
      for (const write of plan.writes) {
        if (write.after !== write.before) fs.writeFileSync(write.path, write.after, "utf-8");
      }
    }
  }
  console.log(`  [ok] updater contracts satisfied for ${plans.length} platform(s)`);
}

if (require.main === module) main();

module.exports = { collectPatches, patchUpdaterSource, patchUpdaterContracts, locateTargets, planBuildDir };
