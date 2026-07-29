#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  FEATURE_NAME,
  MARKER,
  locateTargets,
  patchOwlBootstrapSource,
} = require("./patch-owl-multi-browser");

const BOOTSTRAP_FIXTURE = [
  "var cache=`owl-feature-bootstrap-cache.json`,forced=[];",
  "function bootstrap(features=[]){",
  "forced=uniq(features);",
  "let state=read(),enabled=get(`enable-features`),disabled=get(`disable-features`);",
  "return{enabledFeatureNames:state.enabledFeatureNames,disabledFeatureNames:state.disabledFeatureNames}",
  "}",
].join("");

test("forces OwlWebViewEnhancements through the live bootstrap preset", () => {
  const first = patchOwlBootstrapSource(BOOTSTRAP_FIXTURE);
  assert.equal(first.status, "patched");
  assert.deepEqual(first.counts, { patchable: 1, already: 0, total: 1 });
  assert.match(
    first.code,
    new RegExp(
      String.raw`forced=uniq\(\[\.\.\.features,\`${FEATURE_NAME}\`/\* ${MARKER} \*/\]\)`,
    ),
  );

  const second = patchOwlBootstrapSource(first.code);
  assert.equal(second.status, "already");
  assert.deepEqual(second.counts, { patchable: 0, already: 1, total: 1 });
  assert.equal(second.code, first.code);
});

test("fails closed for duplicate bootstrap contracts", () => {
  const duplicate = BOOTSTRAP_FIXTURE + BOOTSTRAP_FIXTURE.replaceAll(
    "bootstrap",
    "otherBootstrap",
  );
  assert.throws(
    () => patchOwlBootstrapSource(duplicate),
    /expected exactly 1 target, found 2/,
  );
});

test("fails closed when the preset argument shape changes", () => {
  assert.throws(
    () =>
      patchOwlBootstrapSource(
        BOOTSTRAP_FIXTURE.replace("uniq(features)", "uniq(remoteFeatures)"),
      ),
    /unexpected shape/,
  );
});

test("rejects a marker detached from the live bootstrap target", () => {
  const patched = patchOwlBootstrapSource(BOOTSTRAP_FIXTURE).code;
  const detached = patched
    .replace(`/* ${MARKER} */`, "")
    .replace("var cache=", `/* ${MARKER} */var cache=`);
  assert.throws(
    () => patchOwlBootstrapSource(detached),
    /detached from the live target/,
  );
});

test("recognizes and patches the current extracted Windows bootstrap", () => {
  const targets = locateTargets("win");
  assert.equal(targets.length, 1);
  const result = patchOwlBootstrapSource(targets[0].source);
  assert.equal(result.counts.total, 1);
  assert.ok(result.code.includes(FEATURE_NAME));
  assert.ok(result.code.includes(MARKER));
});

test("standard patch pipeline includes owl multi-browser", () => {
  const patchAll = fs.readFileSync(path.join(__dirname, "patch-all.js"), "utf8");
  assert.match(patchAll, /"patch-owl-multi-browser\.js"/);
});
