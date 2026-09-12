#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const { ASSET, installWindowsCuaBindings, patchGlobalsSource } = require("./patch-windows-cua-bindings");

const GLOBALS = 'import{cua as r}from"../cua.js";import{create_tinysky_alt as t}from"./create_tinysky_alt.js";null!==r.browsers&&null!==r.computer||await r.initialize();const{browsers:i,computer:l}=r;if(null===i||null===l)throw new Error("tinyskyAlt failed to initialize");Reflect.set(globalThis,"cua",t({browsers:i,computer:l}));';
const SETUP_GLOBALS = 'import{__awaiter as t}from"../../../../../node_modules/tslib.js";import{create_tinysky_alt as e}from"./create_tinysky_alt.js";let i;const l={initialize(){return t(this,void 0,void 0,function*(){return yield n(),l.getState()})}};function n(t={}){return null!=i||(i=e(t).then(t=>{Object.assign(l,t)})),i}Reflect.set(globalThis,"cua",l);export{n as setupCUA};';
const EAGER_GLOBALS = 'import{create_tinysky_alt as e}from"./create_tinysky_alt.js";var r;const o=globalThis.nodeRepl,t=null===(r=null==o?void 0:o.env)||void 0===r?void 0:r.CUA_REPL_ENABLED_SURFACES;if(void 0===t)throw new Error("CUA_REPL_ENABLED_SURFACES is required");const i=new Set(t.split(",").map((e=>e.trim())).filter(Boolean)),s=["browser","computer"];const n=await e({browser:i.has("browser"),computer:i.has("computer")});Object.assign(n,{initialize:n.getState}),Reflect.set(globalThis,"cua",n);';

test("installs Windows bindings into the CUA runtime idempotently", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-windows-cua-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const globals = path.join(root, "dist/lib/js/oai_js_cua/src/tinysky_alt/globals.js");
  fs.mkdirSync(path.dirname(globals), { recursive: true });
  fs.writeFileSync(globals, GLOBALS);
  const first = installWindowsCuaBindings(root);
  assert.equal(first.changed, true);
  assert.ok(fs.existsSync(first.bindings));
  assert.match(fs.readFileSync(globals, "utf8"), /installWindowsAppBindings/);
  assert.equal(installWindowsCuaBindings(root).changed, false);
  assert.throws(() => patchGlobalsSource("export {};"), /import changed/);
});

test("installs after current deferred CUA setup", () => {
  const patched = patchGlobalsSource(SETUP_GLOBALS);
  assert.match(patched, /installWindowsAppBindings/);
  assert.match(patched, /Object\.assign\(l,t\);return installWindowsAppBindings\(l\)/);
});

test("installs after current eager CUA setup", () => {
  const patched = patchGlobalsSource(EAGER_GLOBALS);
  assert.match(
    patched,
    /Object\.assign\(n,\{initialize:n\.getState\}\);await installWindowsAppBindings\(n\);Reflect\.set\(globalThis,"cua",n\)/,
  );
  assert.equal(patchGlobalsSource(patched), patched);
});

test("standard patch pipeline installs Windows CUA bindings after the screenshot fallback", () => {
  const patchAll = fs.readFileSync(path.join(__dirname, "patch-all.js"), "utf8");
  assert.ok(
    patchAll.indexOf('"patch-computer-use-win10-fallback.js"') <
      patchAll.indexOf('"patch-windows-cua-bindings.js"'),
  );
});

test("Windows CUA binding lists, captures, and targets one returned app window", async (t) => {
  const previousCua = globalThis.cua;
  const previousRepl = globalThis.nodeRepl;
  t.after(() => { globalThis.cua = previousCua; globalThis.nodeRepl = previousRepl; });
  const calls = [];
  const writes = [];
  globalThis.nodeRepl = { write: (value) => writes.push(value), emitImage: () => {} };
  globalThis.cua = { computer: {
    target: "windows",
    async list_apps() { return [{ id: "demo", displayName: "Demo", windows: [{ app: "demo.exe", id: 7, title: "Demo" }] }]; },
    async get_window(input) { calls.push(["get_window", input]); return { ...input, title: "Demo" }; },
    async get_window_state(input) { calls.push(["state", input]); return { window: input.window, accessibility: { tree: "[1] button" }, screenshots: [{ url: "data:image/png;base64,AA==" }] }; },
    async click(input) { calls.push(["click", input]); },
    async press_key(input) { calls.push(["press_key", input]); },
    async type_text(input) { calls.push(["type_text", input]); },
    async scroll(input) { calls.push(["scroll", input]); },
    async drag(input) { calls.push(["drag", input]); },
    async set_value(input) { calls.push(["set_value", input]); },
    async perform_secondary_action(input) { calls.push(["secondary", input]); },
  } };
  const { installWindowsAppBindings } = await import(`${pathToFileURL(ASSET).href}?test=${Date.now()}`);
  await installWindowsAppBindings(globalThis.cua);
  const app = await globalThis.cua.getApp("Demo");
  assert.equal(await app.getAXState({ emit: false }), "[1] button");
  await app.click([10, 20]);
  await app.scroll([5, 6], "down", 2);
  assert.deepEqual(calls.at(-2), ["click", { window: { app: "demo.exe", id: 7, title: "Demo" }, x: 10, y: 20 }]);
  assert.deepEqual(calls.at(-1), ["scroll", { window: { app: "demo.exe", id: 7, title: "Demo" }, x: 5, y: 6, scrollX: 0, scrollY: 1200 }]);
  assert.ok(writes.includes("[1] button"));
});

test("Windows CUA binding launches a returned app with no window", async (t) => {
  const previousCua = globalThis.cua;
  const previousRepl = globalThis.nodeRepl;
  t.after(() => { globalThis.cua = previousCua; globalThis.nodeRepl = previousRepl; });
  const calls = [];
  let running = false;
  globalThis.nodeRepl = { write: () => {}, emitImage: () => {} };
  globalThis.cua = { computer: {
    target: "windows",
    async list_apps() {
      return [{
        id: "demo",
        displayName: "Demo",
        windows: running ? [{ app: "demo.exe", id: 7, title: "Demo" }] : [],
      }];
    },
    async launch_app(input) { calls.push(["launch_app", input]); running = true; },
    async get_window(input) { return { ...input, title: "Demo" }; },
    async get_window_state(input) {
      return { window: input.window, accessibility: { tree: "[1] button" }, screenshots: [{ url: "data:image/png;base64,AA==" }] };
    },
  } };
  const { installWindowsAppBindings } = await import(`${pathToFileURL(ASSET).href}?test=${Date.now()}`);
  await installWindowsAppBindings(globalThis.cua);
  await globalThis.cua.getApp("Demo");
  assert.deepEqual(calls, [["launch_app", { app: "demo" }]]);
});
