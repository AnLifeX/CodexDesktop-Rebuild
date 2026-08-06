#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const {
  CLIENT_IMPORT,
  FALLBACK_MODULE_SOURCE,
  RUNTIME_HELPER_IMPORT_PATH,
  installFallback,
  patchClientSource,
  runtimeFallbackModuleSource,
} = require("./patch-computer-use-win10-fallback");

function runtimeClientFixture() {
  return [
    'import{WindowsComputerUseClientBase as s}from"./computer_use_client_base.js";',
    'class u extends s{constructor(t={}){const e={transport:t.transport};super({transport:e.transport}),p.set(this,null)}}',
  ].join("");
}

test("patches the 26.730 @oai/sky runtime client", () => {
  const patched = patchClientSource(runtimeClientFixture());
  assert.ok(patched.includes(CLIENT_IMPORT));
  assert.match(patched, /super\(\{transport:e\.transport\}\),installWindowsLegacyScreenshotFallback\(this\),/);
  assert.equal(patchClientSource(patched), patched, "runtime patch must be idempotent");
});

test("fails closed when upstream Computer Use client anchors change", () => {
  assert.throws(
    () => patchClientSource("export default {};"),
    /runtime import anchor changed/,
  );
});

test("installs the fallback module and helper beside the 26.730 runtime client", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-cua-runtime-fallback-"));
  const runtimePackageRoot = path.join(root, "sky");
  const runtimeClientPath = path.join(
    runtimePackageRoot,
    "dist/project/cua/sky_js/src/targets/windows/internal/computer_use_client.js",
  );
  fs.mkdirSync(path.dirname(runtimeClientPath), { recursive: true });
  fs.writeFileSync(
    runtimeClientPath,
    runtimeClientFixture(),
  );
  let compiledTarget = null;
  const result = installFallback(runtimePackageRoot, {
    compileCaptureHelper(target) {
      compiledTarget = target;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "fixture");
    },
  });

  assert.equal(compiledTarget, result.helperPath);
  assert.equal(
    fs.readFileSync(result.modulePath, "utf8"),
    runtimeFallbackModuleSource(),
  );
  assert.match(
    fs.readFileSync(result.clientPath, "utf8"),
    /installWindowsLegacyScreenshotFallback\(this\)/,
  );
  assert.equal(fs.readFileSync(result.helperPath, "utf8"), "fixture");
  assert.equal(
    path.resolve(path.dirname(result.modulePath), RUNTIME_HELPER_IMPORT_PATH),
    result.helperPath,
  );
});

test("legacy fallback returns screenshots and removes synthetic screenshot IDs", async () => {
  const moduleUrl = `${pathToFileURL(FALLBACK_MODULE_SOURCE).href}?test=${Date.now()}`;
  const fallback = await import(moduleUrl);
  assert.equal(fallback.getWindowsBuildNumber("10.0.19045"), 19045);
  assert.equal(fallback.shouldPreferLegacyScreenshotFallback("10.0.19045"), true);
  assert.equal(fallback.shouldPreferLegacyScreenshotFallback("10.0.22631"), false);

  const requests = [];
  const client = {
    async get_window(input) {
      return { ...input, title: "fixture" };
    },
    async get_window_state(input) {
      requests.push(["state", input]);
      throw new Error("native screenshot must not run on legacy Windows");
    },
    async click(input) {
      requests.push(["click", input]);
    },
    async scroll(input) {
      requests.push(["scroll", input]);
    },
    async drag(input) {
      requests.push(["drag", input]);
    },
  };
  const emitted = [];
  fallback.installWindowsLegacyScreenshotFallback(client, {
    releaseValue: "10.0.19045",
    async captureWindow() {
      return {
        url: "data:image/png;base64,AA==",
        width: 800,
        height: 600,
        originX: 10,
        originY: 20,
      };
    },
    async emitImage(url) {
      emitted.push(url);
    },
  });

  const state = await client.get_window_state({
    window: { app: "fixture.exe", id: 123 },
  });
  assert.equal(state.screenshots.length, 1);
  assert.match(state.screenshots[0].id, /^codex-gdi-/);
  assert.equal(state.screenshots[0].width, 800);
  assert.deepEqual(emitted, ["data:image/png;base64,AA=="]);

  await client.click({
    window: state.window,
    screenshotId: state.screenshots[0].id,
    x: 4,
    y: 5,
  });
  assert.deepEqual(requests.at(-1), [
    "click",
    { window: state.window, x: 4, y: 5 },
  ]);
});

test("standard patch pipeline includes the screenshot fallback", () => {
  const patchAll = fs.readFileSync(path.join(__dirname, "patch-all.js"), "utf8");
  assert.match(patchAll, /"patch-computer-use-win10-fallback\.js"/);
  assert.ok(
    patchAll.indexOf('"patch-computer-use-win10.js"') <
      patchAll.indexOf('"patch-computer-use-win10-fallback.js"'),
  );
});
