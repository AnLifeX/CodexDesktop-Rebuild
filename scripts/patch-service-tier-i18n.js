#!/usr/bin/env node
/** Prefer the localized descriptor when a known service tier repeats its English fallback. */
const fs = require("node:fs");
const path = require("node:path");
const { relPath, SRC_DIR } = require("./patch-util");

const MESSAGE_ID = "serviceTier.ultrafast.description";
const MARKER = "/* CodexRebuildServiceTierI18n */";
const REMOTE_DESCRIPTION =
  /case`ultrafast`:return (?<description>[A-Za-z_$][\w$]*\?\.description)\?\?(?<fallback>[A-Za-z_$][\w$]*\.ultrafastDescription)/g;

function patchServiceTierI18nSource(source) {
  const markerCount = source.split(MARKER).length - 1;
  if (markerCount > 1) {
    throw new Error(`service tier i18n marker expected at most once, found ${markerCount}`);
  }
  if (markerCount === 1) return { code: source, status: "already" };

  const matches = [...source.matchAll(REMOTE_DESCRIPTION)];
  if (matches.length !== 1) {
    throw new Error(
      `service tier remote description expected exactly once, found ${matches.length}`,
    );
  }
  const match = matches[0];
  const { description, fallback } = match.groups;
  const replacement =
    `case\`ultrafast\`:return (` +
    `${description}==null||${description}.replace(/\\.$/,\`\`)===${fallback}.defaultMessage` +
    `?${fallback}:${description})${MARKER}`;
  return {
    code:
      source.slice(0, match.index) +
      replacement +
      source.slice(match.index + match[0].length),
    status: "patched",
  };
}

function platformNames(platform) {
  if (platform === "unix") return ["mac-arm64", "mac-x64"];
  if (platform) return [platform];
  return ["mac-arm64", "mac-x64", "win"].filter((name) =>
    fs.existsSync(path.join(SRC_DIR, name, "_asar", "webview", "assets")),
  );
}

function locateTargets(platform) {
  const targets = [];
  for (const name of platformNames(platform)) {
    const assetsDir = path.join(SRC_DIR, name, "_asar", "webview", "assets");
    if (!fs.existsSync(assetsDir)) continue;
    const matches = fs.readdirSync(assetsDir).filter((file) => {
      if (!/^app-initial.*\.js$/.test(file)) return false;
      const source = fs.readFileSync(path.join(assetsDir, file), "utf8");
      return source.includes(MESSAGE_ID) && source.includes("case`ultrafast`:return");
    });
    if (matches.length > 1) {
      throw new Error(`Expected at most one service tier bundle for ${name}, found ${matches.length}`);
    }
    if (matches.length === 1) {
      targets.push({ platform: name, path: path.join(assetsDir, matches[0]) });
    }
  }
  return targets;
}

function main() {
  const args = process.argv.slice(2);
  const platform = args.find((value) =>
    ["mac-arm64", "mac-x64", "win", "unix"].includes(value),
  );
  const isCheck = args.includes("--check");
  const targets = locateTargets(platform);
  if (targets.length === 0) {
    console.log("  [ok] No remote ultrafast description override found");
    return;
  }
  for (const target of targets) {
    const source = fs.readFileSync(target.path, "utf8");
    const result = patchServiceTierI18nSource(source);
    console.log(`  [${target.platform}] ${relPath(target.path)} (${result.status})`);
    if (!isCheck && result.code !== source) fs.writeFileSync(target.path, result.code, "utf8");
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

module.exports = { locateTargets, patchServiceTierI18nSource };
