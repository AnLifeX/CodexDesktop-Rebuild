const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { listJavaScriptFiles } = require("./patch-util");

test("discovers nested numeric webview chunks with portable paths and ignores non-files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-webview-discovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "async", "directory.js"), { recursive: true });
  fs.writeFileSync(path.join(root, "async", "123.abcd.js"), "nested");
  fs.writeFileSync(path.join(root, "index-old.js"), "legacy");
  fs.writeFileSync(path.join(root, "async", "123.abcd.js.map"), "map");
  assert.deepEqual(listJavaScriptFiles(root), ["async/123.abcd.js", "index-old.js"]);
  assert.equal(fs.readFileSync(path.join(root, listJavaScriptFiles(root)[0]), "utf8"), "nested");
});
