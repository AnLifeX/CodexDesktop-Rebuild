#!/usr/bin/env node
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { patchUpdaterSource, patchUpdaterContracts, locateTargets } = require("./patch-updater");

const UPDATER_FIXTURE =
  "let policy={shouldIncludeSparkle:function(e,t,n){return m(e,t,`darwin`,n)},shouldIncludeWindowsUpdater:function(e,t,n){return h(e,t,n)&&g(e)!=null},shouldIncludeWindowsMsixUpdater:function(e,t,n){return h(e,t,n)&&g(e)?.kind===`msix`},shouldIncludeUpdater:function(e,t,n){return policy.shouldIncludeSparkle(e,t,n)||policy.shouldIncludeWindowsUpdater(e,t,n)}}";

test("locates renamed policy bundles by definitions, ignoring callers and preserving ambiguous targets", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-updater-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "worker.js"), UPDATER_FIXTURE);
  fs.writeFileSync(path.join(dir, "main-current.js"), "policy.shouldIncludeSparkle(e,t,n);policy.shouldIncludeUpdater(e,t,n)");
  for (const name of ["file-based-logger-old.js", "bootstrap-current.js"]) {
    const file = path.join(dir, name);
    // Current upstream uses shorthand methods; older bundles used function properties.
    const source = name.startsWith("bootstrap")
      ? UPDATER_FIXTURE.replaceAll(":function", "")
      : UPDATER_FIXTURE;
    fs.writeFileSync(file, source);
    assert.deepEqual(locateTargets(dir).sort(), [name, "worker.js"].sort());
    const patched = patchUpdaterSource(source);
    fs.writeFileSync(file, patched.code);
    assert.deepEqual(locateTargets(dir).sort(), [name, "worker.js"].sort());
    fs.unlinkSync(file);
  }
  assert.deepEqual(locateTargets(dir), ["worker.js"]);
  fs.writeFileSync(path.join(dir, "bootstrap-one.js"), UPDATER_FIXTURE);
  fs.writeFileSync(path.join(dir, "bootstrap-two.js"), UPDATER_FIXTURE);
  assert.equal(locateTargets(dir).length, 3);
});

test("disables all four updater methods in one current bundle idempotently", () => {
  assert.equal(typeof patchUpdaterSource, "function");
  const first = patchUpdaterSource(UPDATER_FIXTURE);
  assert.equal(first.status, "patched");
  assert.equal(first.counts.patchable, 4);
  assert.equal(first.counts.already, 0);
  assert.equal(first.counts.total, 4);
  for (const method of [
    "shouldIncludeSparkle",
    "shouldIncludeWindowsUpdater",
    "shouldIncludeWindowsMsixUpdater",
    "shouldIncludeUpdater",
  ]) {
    assert.deepEqual(first.counts.methods[method], { patchable: 1, already: 0, total: 1 });
  }
  assert.equal((first.code.match(/return !1/g) ?? []).length, 4);
  const second = patchUpdaterSource(first.code);
  assert.equal(second.status, "already");
  assert.equal(second.counts.patchable, 0);
  assert.equal(second.counts.already, 4);
  assert.equal(second.code, first.code);
});

test("requires both current updater copies for the eight-method contract", () => {
  assert.equal(typeof patchUpdaterContracts, "function");
  const first = patchUpdaterContracts({ loggerSource: UPDATER_FIXTURE, workerSource: UPDATER_FIXTURE });
  assert.equal(first.status, "patched");
  assert.equal(first.counts.patchable, 8);
  assert.equal(first.counts.total, 8);
  const second = patchUpdaterContracts({
    loggerSource: first.logger.code,
    workerSource: first.worker.code,
  });
  assert.equal(second.status, "already");
  assert.equal(second.counts.already, 8);
});

test("rejects parse, zero, ambiguous, and half-contract updater inputs", () => {
  assert.equal(typeof patchUpdaterSource, "function");
  assert.throws(() => patchUpdaterSource("function {"), /parse failed/i);
  assert.throws(() => patchUpdaterSource("let policy={}"), /shouldIncludeSparkle.*found 0/i);
  assert.throws(
    () => patchUpdaterSource(`${UPDATER_FIXTURE};${UPDATER_FIXTURE.replace("policy", "other")}`),
    /shouldIncludeSparkle.*found 2/i,
  );
  assert.throws(() => patchUpdaterContracts({ loggerSource: UPDATER_FIXTURE }), /worker.*required/i);
});
