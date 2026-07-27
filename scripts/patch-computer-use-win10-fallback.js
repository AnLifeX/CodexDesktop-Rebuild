#!/usr/bin/env node
/**
 * Add a GDI/PrintWindow screenshot fallback to the bundled Computer Use plugin.
 *
 * Windows.Graphics.Capture can successfully create a session on some Windows
 * 10 systems but never deliver its first frame. The plugin-side fallback avoids
 * that path on legacy builds and is also used for known native capture failures
 * on newer Windows versions.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { SRC_DIR, relPath } = require("./patch-util");

const ASSET_DIR = path.join(__dirname, "assets", "computer-use");
const FALLBACK_MODULE_SOURCE = path.join(
  ASSET_DIR,
  "windows-legacy-screenshot-fallback.mjs",
);
const CAPTURE_HELPER_SOURCE = path.join(ASSET_DIR, "CodexGdiCapture.cs");
const DEFAULT_PLUGIN_ROOT = path.join(
  SRC_DIR,
  "win",
  "plugins",
  "openai-bundled",
  "plugins",
  "computer-use",
);
const CLIENT_IMPORT =
  'import { installWindowsLegacyScreenshotFallback } from "./windows-legacy-screenshot-fallback.mjs";';
const CLIENT_CONSTRUCTOR = `  constructor(options) {
    super(options);
    installWindowsLegacyScreenshotFallback(this);
  }

`;

function patchClientSource(source) {
  let result = source;
  if (!result.includes(CLIENT_IMPORT)) {
    const anchor = 'import { pathToFileURL } from "node:url";';
    if (!result.includes(anchor)) {
      throw new Error("Computer Use client URL import anchor changed");
    }
    result = result.replace(anchor, `${anchor}\n${CLIENT_IMPORT}`);
  }

  if (!result.includes("installWindowsLegacyScreenshotFallback(this);")) {
    const anchor =
      /(class NativePipeComputerUseClient extends WindowsComputerUseClientBase \{\r?\n)/;
    if (!anchor.test(result)) {
      throw new Error("Computer Use native client class anchor changed");
    }
    result = result.replace(anchor, `$1${CLIENT_CONSTRUCTOR}`);
  }
  return result;
}

function findCSharpCompiler(env = process.env, exists = fs.existsSync) {
  const windowsDirectory = env.WINDIR || env.SystemRoot || "C:\\Windows";
  const candidates = [
    path.join(
      windowsDirectory,
      "Microsoft.NET",
      "Framework64",
      "v4.0.30319",
      "csc.exe",
    ),
    path.join(
      windowsDirectory,
      "Microsoft.NET",
      "Framework",
      "v4.0.30319",
      "csc.exe",
    ),
  ];
  const compiler = candidates.find((candidate) => exists(candidate));
  if (!compiler) {
    throw new Error(".NET Framework C# compiler was not found");
  }
  return compiler;
}

function compileCaptureHelper(
  target,
  { env = process.env, exec = execFileSync, exists = fs.existsSync } = {},
) {
  const compiler = findCSharpCompiler(env, exists);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  exec(
    compiler,
    [
      "/nologo",
      "/target:exe",
      "/platform:x64",
      "/optimize+",
      "/debug-",
      "/reference:System.Drawing.dll",
      `/out:${target}`,
      CAPTURE_HELPER_SOURCE,
    ],
    { stdio: "pipe" },
  );
}

function installFallback(pluginRoot, options = {}) {
  const clientPath = path.join(pluginRoot, "scripts", "computer-use-client.mjs");
  if (!fs.existsSync(clientPath)) {
    throw new Error(`Computer Use client is missing: ${clientPath}`);
  }
  const original = fs.readFileSync(clientPath, "utf8");
  const patched = patchClientSource(original);
  const modulePath = path.join(
    pluginRoot,
    "scripts",
    "windows-legacy-screenshot-fallback.mjs",
  );
  const helperPath = path.join(
    pluginRoot,
    "bin",
    "windows",
    "codex-gdi-capture.exe",
  );

  if (!options.check) {
    if (patched !== original) fs.writeFileSync(clientPath, patched);
    fs.copyFileSync(FALLBACK_MODULE_SOURCE, modulePath);
    (options.compileCaptureHelper ?? compileCaptureHelper)(helperPath);
  }
  return {
    changed: patched !== original,
    clientPath,
    helperPath,
    modulePath,
  };
}

function parsePluginRoot(args) {
  const index = args.indexOf("--plugin-root");
  if (index === -1) return DEFAULT_PLUGIN_ROOT;
  const value = args[index + 1];
  if (!value) throw new Error("--plugin-root requires a path");
  return path.resolve(value);
}

function main() {
  const args = process.argv.slice(2);
  const platform = args.find((arg) =>
    ["mac-arm64", "mac-x64", "win", "unix"].includes(arg),
  );
  if (platform && platform !== "win") {
    console.log("  [ok] Computer Use legacy screenshot fallback only applies to Windows");
    return;
  }

  const pluginRoot = parsePluginRoot(args);
  if (!fs.existsSync(pluginRoot)) {
    if (platform === "win") {
      throw new Error(`Computer Use plugin is missing: ${pluginRoot}`);
    }
    console.log(`  [ok] No Windows Computer Use plugin found at ${relPath(pluginRoot)}`);
    return;
  }

  const result = installFallback(pluginRoot, {
    check: args.includes("--check"),
  });
  const action = args.includes("--check")
    ? "legacy screenshot fallback is applicable"
    : result.changed
      ? "installed legacy screenshot fallback"
      : "refreshed legacy screenshot fallback";
  console.log(`  [ok] ${relPath(result.clientPath)}: ${action}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[x] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  CAPTURE_HELPER_SOURCE,
  CLIENT_CONSTRUCTOR,
  CLIENT_IMPORT,
  FALLBACK_MODULE_SOURCE,
  compileCaptureHelper,
  findCSharpCompiler,
  installFallback,
  patchClientSource,
};
