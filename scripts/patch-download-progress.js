#!/usr/bin/env node
const fs = require("node:fs");
const { locateBundles, relPath } = require("./patch-util");

const MARKER = "/* CodexRebuildDownloadProgress */";

function patchDownloadProgressSource(source) {
  if (source.includes(MARKER)) return { code: source, status: "already" };
  let count = 0;
  const code = source.replace(
    /([\w$]+)\.on\([`"\x27]updated[`"\x27],\(\)=>\{[^{}]*?\.setProgressBar\(([\w$]+(?:\(\)|\/[\w$]+))\)/g,
    (match, item, progress) => {
      count++;
      // Recoverable interruptions emit updated without done; clear until transfer resumes.
      return match.replace(
        `.setProgressBar(${progress})`,
        `.setProgressBar(${MARKER}${item}.getState()===\`interrupted\`||${item}.isPaused()?-1:${progress})`,
      );
    },
  );
  if (count !== 1) throw new Error(`Download progress expected exactly 1 handler, found ${count}`);
  return { code, status: "patched" };
}

function main() {
  const args = process.argv.slice(2);
  const platform = args.find((arg) => ["win", "mac-arm64", "mac-x64"].includes(arg));
  const bundles = locateBundles({
    dir: "build",
    pattern: /^(?:main(?:-.*)?|early-bootstrap-\d+-[\da-f]+)\.js$/,
    platform,
    contains: "setProgressBar",
  });
  if (bundles.length === 0) throw new Error("Download progress bundle not found");
  for (const bundle of bundles) {
    const result = patchDownloadProgressSource(fs.readFileSync(bundle.path, "utf8"));
    if (!args.includes("--check") && result.status === "patched") fs.writeFileSync(bundle.path, result.code);
    console.log(`  [${args.includes("--check") ? "check" : result.status}] ${relPath(bundle.path)}: download progress cleanup`);
  }
}

if (require.main === module) main();
module.exports = { patchDownloadProgressSource };
