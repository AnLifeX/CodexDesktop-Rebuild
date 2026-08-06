#!/usr/bin/env node
/**
 * Add a GDI/PrintWindow screenshot fallback to the bundled Computer Use runtime.
 *
 * Windows.Graphics.Capture can successfully create a session on some Windows
 * 10 systems but never deliver its first frame. The runtime-side fallback avoids
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
const DEFAULT_RUNTIME_PACKAGE_ROOT = path.join(
  SRC_DIR,
  "win",
  "cua_node",
  "bin",
  "node_modules",
  "@oai",
  "sky",
);
const RUNTIME_CLIENT_RELATIVE_PATH = path.join(
  "dist",
  "project",
  "cua",
  "sky_js",
  "src",
  "targets",
  "windows",
  "internal",
  "computer_use_client.js",
);
const RUNTIME_HELPER_RELATIVE_PATH = path.join(
  "bin",
  "windows",
  "codex-gdi-capture.exe",
);
const CLIENT_IMPORT =
  'import{installWindowsLegacyScreenshotFallback}from"./windows-legacy-screenshot-fallback.mjs";';
const CLIENT_INSTALL_CALL = "installWindowsLegacyScreenshotFallback(this)";
const RUNTIME_HELPER_IMPORT_PATH = "../../../../../../../../bin/windows/codex-gdi-capture.exe";

function runtimeClientPath(packageRoot = DEFAULT_RUNTIME_PACKAGE_ROOT) {
  return path.join(packageRoot, RUNTIME_CLIENT_RELATIVE_PATH);
}

function runtimeHelperPath(packageRoot = DEFAULT_RUNTIME_PACKAGE_ROOT) {
  return path.join(packageRoot, RUNTIME_HELPER_RELATIVE_PATH);
}

function runtimeFallbackModuleSource() {
  const source = fs.readFileSync(FALLBACK_MODULE_SOURCE, "utf8");
  const anchor =
    'new URL("../bin/windows/codex-gdi-capture.exe", import.meta.url)';
  if (!source.includes(anchor)) {
    throw new Error("Computer Use fallback helper path anchor changed");
  }
  return source.replace(
    anchor,
    `new URL(${JSON.stringify(RUNTIME_HELPER_IMPORT_PATH)}, import.meta.url)`,
  );
}

function patchClientSource(source) {
  let result = source;
  if (!result.includes(CLIENT_IMPORT)) {
    const anchor = 'from"./computer_use_client_base.js";';
    if (!result.includes(anchor)) {
      throw new Error("Computer Use runtime import anchor changed");
    }
    result = result.replace(anchor, `${anchor}${CLIENT_IMPORT}`);
  }

  if (!result.includes(CLIENT_INSTALL_CALL)) {
    const anchor = /super\(\{transport:[^}]+\}\),/;
    if (!anchor.test(result)) {
      throw new Error("Computer Use runtime constructor anchor changed");
    }
    result = result.replace(
      anchor,
      (match) => `${match}installWindowsLegacyScreenshotFallback(this),`,
    );
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

function installFallback(runtimePackageRoot = DEFAULT_RUNTIME_PACKAGE_ROOT, options = {}) {
  const clientPath = runtimeClientPath(runtimePackageRoot);
  if (!fs.existsSync(clientPath)) {
    throw new Error(`Computer Use runtime client is missing: ${clientPath}`);
  }

  const original = fs.readFileSync(clientPath, "utf8");
  const patched = patchClientSource(original);
  const modulePath = path.join(
    path.dirname(clientPath),
    "windows-legacy-screenshot-fallback.mjs",
  );
  const helperPath = runtimeHelperPath(runtimePackageRoot);

  if (!options.check) {
    if (patched !== original) fs.writeFileSync(clientPath, patched);
    fs.writeFileSync(modulePath, runtimeFallbackModuleSource());
    (options.compileCaptureHelper ?? compileCaptureHelper)(helperPath);
  }
  return {
    changed: patched !== original,
    clientPath,
    helperPath,
    modulePath,
  };
}

function parseRuntimePackageRoot(args) {
  const index = args.indexOf("--runtime-package-root");
  if (index === -1) return DEFAULT_RUNTIME_PACKAGE_ROOT;
  const value = args[index + 1];
  if (!value) throw new Error("--runtime-package-root requires a path");
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

  const runtimePackageRoot = parseRuntimePackageRoot(args);
  if (!fs.existsSync(runtimePackageRoot)) {
    if (platform === "win") {
      throw new Error(`Computer Use runtime is missing: ${runtimePackageRoot}`);
    }
    console.log(
      `  [ok] No Windows Computer Use runtime found at ${relPath(runtimePackageRoot)}`,
    );
    return;
  }

  const result = installFallback(runtimePackageRoot, {
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
  CLIENT_IMPORT,
  FALLBACK_MODULE_SOURCE,
  RUNTIME_CLIENT_RELATIVE_PATH,
  RUNTIME_HELPER_IMPORT_PATH,
  RUNTIME_HELPER_RELATIVE_PATH,
  compileCaptureHelper,
  findCSharpCompiler,
  installFallback,
  patchClientSource,
  runtimeClientPath,
  runtimeFallbackModuleSource,
  runtimeHelperPath,
};
