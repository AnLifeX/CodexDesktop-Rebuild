const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { windowsLogDirectory, patchSource } = require("./patch-windows-log-path");

test("installed app writes logs in new root; portable and legacy paths retain their behavior", () => {
  const local = path.resolve("local");
  for (const name of ["app-26.1021.31345", "app-26.1021.31346-rebuild0001"]) {
    const resolve = vm.runInNewContext(`(${windowsLogDirectory})`, { require, process: { execPath: path.join(local, "Programs", "Codex", name, "ChatGPT.exe") } });
    assert.equal(resolve(local), path.join(local, "Programs", "Codex", "Logs"));
  }
  for (const exe of [path.join(local, "Codex", "app-1.2.3", "ChatGPT.exe"), path.join(local, "portable", "ChatGPT.exe")]) {
    const resolve = vm.runInNewContext(`(${windowsLogDirectory})`, { require, process: { execPath: exe } });
    assert.equal(resolve(local), path.join(local, "Codex", "Logs"));
  }
});

test("logger patch is idempotent and rejects unknown or duplicate targets", () => {
  const source = "function b(e){return(0,a.join)(e,`Codex`,`Logs`)}";
  const next = patchSource(source);
  assert.ok(next.includes("windowsLogDirectory"));
  assert.equal(patchSource(next), next);
  assert.ok(patchSource(source.replaceAll("a.join", "g.join")).includes("windowsLogDirectory"));
  assert.throws(() => patchSource("unknown"), /Expected one/);
  assert.throws(() => patchSource(source + source), /Expected one/);
});
