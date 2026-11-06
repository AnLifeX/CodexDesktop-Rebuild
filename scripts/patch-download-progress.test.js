const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { patchDownloadProgressSource } = require("./patch-download-progress");

const source = fs.readFileSync(path.join(__dirname, "fixtures/download-progress.js"), "utf8");

function download(options = {}, input = source) {
  const session = new EventEmitter();
  const item = Object.assign(new EventEmitter(), {
    state: "progressing", paused: false, bytes: 25,
    getState() { return this.state; },
    isPaused() { return this.paused; },
    getReceivedBytes() { return this.bytes; },
    getTotalBytes: () => 100,
    getFilename: () => "file.zip",
    setSavePath() {},
    getSavePath: () => "/downloads/file.zip",
    getMimeType: () => "application/zip",
    getURL: () => "https://example.test/file.zip",
  });
  const progress = [], results = [];
  const window = { isDestroyed: () => false, setProgressBar: (value) => progress.push(value) };
  const context = {
    k: { BrowserWindow: { fromWebContents: () => window }, app: { getPath: () => "/downloads" } },
    w: { default: path.posix }, L: { default: { platform: "win32" } },
    Bbt: (value) => value, Gbt: (value) => value, nxt: Error,
  };
  vm.runInNewContext(patchDownloadProgressSource(input).code + ";this.start=ixt", context);
  context.start(session, options, (error, result) => results.push({ error, result }));
  session.emit("will-download", {}, item, {});
  return { item, window, progress, results };
}

test("interrupted download clears the icon and resuming restores progress without done", () => {
  const { item, progress, results } = download();
  item.emit("updated");
  item.state = "interrupted";
  item.emit("updated", {}, "interrupted");
  assert.deepEqual(progress, [0.25, -1]);
  assert.equal(results.length, 0);
  item.state = "progressing";
  item.bytes = 60;
  item.emit("updated");
  assert.deepEqual(progress, [0.25, -1, 0.6]);
});

test("current upstream handler clears interrupted progress", () => {
  const current = source.replace("d.on(`updated`", 'd.on("updated"').replace(".setProgressBar(c())", ".setProgressBar(i/o)");
  const { item, progress } = download({}, current);
  item.emit("updated");
  item.state = "interrupted";
  item.emit("updated");
  assert.deepEqual(progress, [0.25, -1]);
});
test("pause clears the icon, resume restores it, and showProgressBar false is respected", () => {
  const { item, progress } = download();
  item.paused = true;
  item.emit("updated");
  item.paused = false;
  item.emit("updated");
  assert.deepEqual(progress, [-1, 0.25]);
  const hidden = download({ showProgressBar: false });
  hidden.item.state = "interrupted";
  hidden.item.emit("updated");
  assert.deepEqual(hidden.progress, []);
});

for (const state of ["completed", "cancelled", "interrupted"]) {
  test(`${state} still clears progress and reports completion or failure`, () => {
    const { item, progress, results } = download();
    item.emit("updated");
    item.emit("done", {}, state);
    assert.deepEqual(progress, [0.25, -1]);
    assert.equal(results.length, 1);
    assert.equal(Boolean(results[0].error), state !== "completed");
  });
}

test("destroyed windows are ignored and patch is idempotent and fails on changed upstream code", () => {
  const { item, window, progress } = download();
  window.isDestroyed = () => true;
  item.emit("updated");
  item.emit("done", {}, "cancelled");
  assert.deepEqual(progress, []);
  const patched = patchDownloadProgressSource(source);
  assert.deepEqual(patchDownloadProgressSource(patched.code), { code: patched.code, status: "already" });
  assert.throws(() => patchDownloadProgressSource(""), /found 0/);
  assert.throws(() => patchDownloadProgressSource(source + source), /found 2/);
});
