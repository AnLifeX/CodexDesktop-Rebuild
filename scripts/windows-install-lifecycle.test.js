const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { windowsInstallLifecycle } = require("./windows-install-lifecycle");

function fixture(t, { legacy = false, event, targetExists = false } = {}) {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), "codex-install-js-"));
  t.after(() => fs.rmSync(local, { recursive: true, force: true }));
  const root = legacy ? path.join(local, "Codex") : path.join(local, "Programs", "Codex");
  const appDir = path.join(root, "app-1.2.3");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(root, "Update.exe"), "updater");
  fs.writeFileSync(path.join(appDir, "CodexUpdater.exe"), "helper");
  if (targetExists) fs.mkdirSync(path.join(local, "Programs", "Codex"), { recursive: true });
  const calls = [], children = [], timers = new Set();
  const app = new EventEmitter();
  Object.assign(app, { isPackaged: true, getAppPath: () => path.join(appDir, "resources", "app.asar"), quit: () => calls.push("quit") });
  const processMock = { execPath: path.join(appDir, "ChatGPT.exe"), pid: 123, argv: ["ChatGPT.exe", ...(event ? [event] : [])], env: { LOCALAPPDATA: local } };
  const cp = {
    spawn(exe, args, options) {
      calls.push({ exe, args, options });
      const child = new EventEmitter(); child.unref = () => {}; children.push(child); return child;
    },
    spawnSync(exe, args, options) { calls.push({ exe, args, options }); return { status: 0 }; },
  };
  const context = {
    process: processMock, console,
    require(id) { return id === "node:child_process" ? cp : require(id); },
    setTimeout(callback, delay) { const timer = { callback, delay, unref() {} }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
  };
  const run = vm.runInNewContext(`(${windowsInstallLifecycle.toString()})`, context);
  return { local, root, appDir, app, processMock, calls, children, timers, run: (windows = []) => run(app, { getAllWindows: () => windows }) };
}

function windowFixture(f, { url = "app://-/index.html", rendered = true } = {}) {
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.webContents = new EventEmitter();
  Object.assign(window.webContents, { getURL: () => url, isDestroyed: () => false, executeJavaScript: async () => rendered });
  f.app.emit("browser-window-created", {}, window);
  window.webContents.emit("did-finish-load");
  return window;
}

test("migration is launched from an ordinary legacy start, preserves arguments, and waits for spawn before quitting", t => {
  const f = fixture(t, { legacy: true });
  f.processMock.argv.push("codex://threads/example");
  assert.equal(f.run(), false);
  assert.deepEqual(Array.from(f.calls[0].args), ["--maintenance-migrate", f.root, "app-1.2.3", "123", "codex://threads/example"]);
  assert.ok(!f.calls.includes("quit"));
  f.children[0].emit("spawn");
  assert.equal(f.calls.at(-1), "quit");
});

test("Squirrel update records retention synchronously without attempting migration", t => {
  const f = fixture(t, { legacy: true, event: "--squirrel-updated" });
  assert.equal(f.run(), false);
  assert.deepEqual(Array.from(f.calls[0].args), ["--maintenance-retain", f.root, "app-1.2.3"]);
  assert.equal(f.children.length, 0);
});

test("a destination conflict or failed migration leaves the legacy app usable", t => {
  const f = fixture(t, { legacy: true, targetExists: true });
  assert.equal(f.run(), false);
  assert.equal(f.calls.length, 0);
  fs.writeFileSync(path.join(f.root, ".codex-migration-failed"), "app-1.2.3");
  assert.equal(f.run(), false);
  assert.equal(f.calls.length, 0);
});

test("only the rendered application stable for 30 seconds confirms startup", async t => {
  const f = fixture(t);
  assert.equal(f.run(), false);
  windowFixture(f, { url: "data:text/html,updater" });
  windowFixture(f, { url: "https://example.com" });
  windowFixture(f, { url: "app://-/detached-window.html" });
  assert.equal(f.timers.size, 0);
  windowFixture(f);
  assert.equal(f.timers.size, 1);
  const timer = [...f.timers][0];
  assert.equal(timer.delay, 30000);
  assert.equal(f.calls.length, 0);
  await timer.callback();
  assert.deepEqual(Array.from(f.calls[0].args), ["--maintenance-confirm", f.root, "app-1.2.3"]);
});

test("a crash, navigation, failed load, or blank renderer never starts the retirement clock", async t => {
  for (const event of ["render-process-gone", "did-start-navigation", "did-fail-load"]) {
    const f = fixture(t); f.run(); const window = windowFixture(f);
    window.webContents.emit(event, {}, 0, false, "app://-/index.html", true);
    if (event === "did-start-navigation") window.webContents.emit(event, {}, "app://-/other", false, true);
    assert.equal(f.timers.size, 0);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(t); f.run(); windowFixture(f, { rendered: false });
  await [...f.timers][0].callback();
  assert.equal(f.calls.length, 0);
});

test("late renderer content and a failed confirmation are retried; only successful exit confirms", async t => {
  const f = fixture(t); f.run(); const window = windowFixture(f, { rendered: false });
  await [...f.timers][0].callback();
  assert.equal([...f.timers].at(-1).delay, 5000);
  window.webContents.executeJavaScript = async () => true;
  await [...f.timers].at(-1).callback();
  f.children[0].emit("spawn"); f.children[0].emit("exit", 1);
  await [...f.timers].at(-1).callback();
  assert.equal(f.children.length, 2);
  f.children[1].emit("exit", 0);
  await [...f.timers].at(-1).callback();
  assert.equal(f.children.length, 2);
});

test("subframe loading does not cancel main-window confirmation", async t => {
  const f = fixture(t); f.run(); const window = windowFixture(f);
  window.webContents.emit("did-start-loading");
  window.webContents.emit("did-start-navigation", {}, "https://example.com", false, false);
  window.webContents.emit("did-fail-load", {}, -3, "cancelled", "https://example.com", false);
  assert.equal(f.timers.size, 1);
  await [...f.timers][0].callback();
  assert.equal(f.children.length, 1);
});

test("an already loaded window is observed and main navigation during inspection cancels confirmation", async t => {
  const f = fixture(t); const window = windowFixture(f);
  f.run([window]);
  assert.equal(f.timers.size, 1);
  window.webContents.executeJavaScript = async () => {
    window.webContents.emit("did-start-navigation", {}, "app://-/other", false, true);
    return true;
  };
  await [...f.timers][0].callback();
  assert.equal(f.children.length, 0);
  assert.equal(f.timers.size, 0);
});

test("uninstall removes the cleanup task and portable apps do not migrate", t => {
  const f = fixture(t, { event: "--squirrel-uninstall" }); f.run();
  assert.deepEqual(Array.from(f.calls[0].args), ["--maintenance-uninstall", f.root]);
  const portable = fixture(t); portable.app.isPackaged = false;
  assert.equal(portable.run(), false); assert.equal(portable.calls.length, 0);
});
