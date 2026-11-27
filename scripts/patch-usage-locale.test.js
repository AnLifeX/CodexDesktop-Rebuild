#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MARKER, locateTargets, patchUsageTransportSource } = require("./patch-usage-locale");

const SOURCE =
  'let k=a(h.u,N,({get:e,set:t})=>{e?.userID!==r?t(N()):t("celcius_push"===(0,f.XM)(n,"3960854641").get("transport","polling")?"push":"polling")});' +
  'let decoy="celcius_push"===mode?"push":"polling";';

test("pins the usage transport to localized polling and stays idempotent", () => {
  const first = patchUsageTransportSource(SOURCE);
  assert.equal(first.patched, 1);
  assert.ok(first.code.includes(`t(${MARKER}"polling")`));
  assert.ok(first.code.includes('decoy="celcius_push"===mode?"push":"polling"'));
  const second = patchUsageTransportSource(first.code);
  assert.equal(second.patched, 0);
  assert.equal(second.already, 1);
  assert.equal(second.code, first.code);
});

test("fails closed when the push switch is missing or ambiguous", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-locale-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = path.join(root, "win", "_asar", "webview", "assets", "async");
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, "a.js"), "let x=1;");
  assert.throws(() => locateTargets("win", root), /expected exactly 1 target for win, found 0/);
  fs.writeFileSync(path.join(assets, "b.js"), SOURCE);
  assert.equal(locateTargets("win", root).length, 1);
  fs.writeFileSync(path.join(assets, "c.js"), SOURCE);
  assert.throws(() => locateTargets("win", root), /found 2/);
});

test("runs after the zh-CN catalog in the standard patch pipeline", () => {
  const patchAll = fs.readFileSync(path.join(__dirname, "patch-all.js"), "utf8");
  assert.ok(patchAll.indexOf('"patch-zh-cn-catalog.js"') < patchAll.indexOf('"patch-usage-locale.js"'));
});
