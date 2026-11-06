const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { parse } = require("acorn");
const { webpackModules } = require("./webpack-contracts");
const { planFastModePlatform } = require("./patch-fast-mode");
const { patchPluginWebviewSource } = require("./patch-plugin-auth");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures/windows-webpack", `${name}.js`), "utf8");

test("webpack export getters must belong to their module require and exports bindings", () => {
  const source = "export const __webpack_modules__={m(e,t,n){function hook(){}n.d(t,{U:()=>hook});other.d(t,{X:()=>decoy});n.d(other,{Y:()=>decoy})}}";
  assert.deepEqual(webpackModules(parse(source, { ecmaVersion: "latest", sourceType: "module" }))[0].identifiers.map((id) => id.name), ["hook"]);
});

test("real webpack service access roles span chunks and remain idempotent", () => {
  const candidates = ["fast-settings", "fast-request"].map((name) => ({
    path: `webview/assets/async/${name}.js`, fileName: `${name}.js`, source: fixture(name),
  }));
  const plan = planFastModePlatform({ platform: "win", candidates });
  assert.equal(plan.writes.length, 2);
  const patched = candidates.map((candidate, i) => ({ ...candidate, source: plan.writes[i].result.code }));
  assert.ok(patched[0].source.includes("serviceTierAccess:{fast:!0,ultrafast:!0}"));
  assert.ok(patched[1].source.includes("return {fast:!0,ultrafast:!0}"));
  assert.ok(planFastModePlatform({ platform: "win", candidates: patched }).writes.every((write) => write.result.status === "already"));
  const replica = { ...candidates[0], path: "webview/assets/async/replica.js", fileName: "replica.js" };
  assert.equal(planFastModePlatform({ platform: "win", candidates: [...candidates, replica] }).writes.length, 3);
  assert.throws(() => planFastModePlatform({ platform: "win", candidates: [...candidates, { ...replica, source: replica.source.replace("m0(", "otherModule(") }] }), /ambiguous webpack module identities/);
  assert.throws(() => planFastModePlatform({ platform: "win", candidates: [candidates[0], { ...candidates[1], source: candidates[1].source.replace('"eWgO"', '"wrongDecoder"') }] }), /required role plan failed/);
  assert.throws(() => planFastModePlatform({ platform: "win", candidates: [{ ...candidates[0], source: candidates[0].source.replace('"eWgO"', '"wrongDecoder"') }, candidates[1]] }), /required role plan failed/);
});

test("real webpack plugin hooks include the inline computer auth helper", () => {
  const source = fixture("plugin-hooks");
  const result = patchPluginWebviewSource(source);
  assert.equal(result.counts.auth.patchable, 1);
  assert.equal(result.counts.availability.patchable, 5);
  assert.equal(result.counts.statsig.patchable, 3);
  assert.equal(patchPluginWebviewSource(result.code).code, result.code);
  assert.throws(() => patchPluginWebviewSource(source.replaceAll("n.d(t,", "n.d(unrelated,")), /exported function/);
  assert.throws(() => patchPluginWebviewSource(source.replace('"hZax"', '"wrongGate"')), /expected exactly 1 gate/);
});

test("current webpack direct function exports preserve plugin hook topology", () => {
  const source = fixture("plugin-hooks-current");
  const result = patchPluginWebviewSource(source);
  assert.equal(result.counts.statsig.patchable, 3);
  assert.equal(result.counts.availability.patchable, 5);
  assert.equal(patchPluginWebviewSource(result.code).code, result.code);
  assert.throws(() => patchPluginWebviewSource(source.replaceAll("n.d(t,", "n.d(unrelated,")), /exported function/);
});

test("inlined Fast request markers belong only to the inner decoder gate", () => {
  const candidates = ["fast-settings", "fast-request-current"].map((name) => ({
    path: `webview/assets/async/${name}.js`, fileName: `${name}.js`, source: fixture(name),
  }));
  const first = planFastModePlatform({ platform: "win", candidates });
  const patched = candidates.map((candidate, i) => ({ ...candidate, source: first.writes[i].result.code }));
  assert.ok(planFastModePlatform({ platform: "win", candidates: patched }).writes.every((write) => write.result.status === "already"));
});

test("current sidebar uses its native external menu factory with disabled/work gates intact", () => {
  const { patchSidebarSource } = require("./patch-sidebar-delete");
  const source = fixture("sidebar-current");
  assert.ok(!source.includes('id:"delete-thread"'));
  const result = patchSidebarSource(source);
  assert.ok(result.code.includes('deleteAction:!aS&&!tj?'));
  assert.ok(result.code.includes('(await ay(`row-actions`)).find(e=>e.id===`delete-thread`)?.onSelect()'));
  assert.equal(patchSidebarSource(result.code).code, result.code);
  assert.throws(() => patchSidebarSource(source.replace('getMenuItems:aS||tj?', 'getMenuItems:unknown?')), /menu factory changed/);
});
