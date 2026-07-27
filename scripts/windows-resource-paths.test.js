#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  decodeEscapedResourceName,
  normalizeEscapedResourcePaths,
} = require("./windows-resource-paths");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "windows-resource-paths-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return root;
}

test("decodes AppX-escaped resource names without allowing path traversal", () => {
  assert.equal(decodeEscapedResourceName("%40oai"), "@oai");
  assert.equal(decodeEscapedResourceName("%24_StatsigGlobal.js"), "$_StatsigGlobal.js");
  assert.equal(decodeEscapedResourceName("client%2Bsession.js"), "client+session.js");
  assert.equal(decodeEscapedResourceName("invalid%ZZname"), "invalid%ZZname");
  assert.throws(() => decodeEscapedResourceName("unsafe%2Fchild"), /unsafe decoded/i);
});

test("normalizes scoped packages and encoded files idempotently", (t) => {
  const root = fixture(t);
  const binDir = path.join(root, "bin");
  const modulesDir = path.join(binDir, "node_modules");
  const packageDir = path.join(modulesDir, "%40oai", "sky");
  const statsigDir = path.join(modulesDir, "%40statsig", "client-core", "src");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(statsigDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "@oai/sky", main: "index.js" }),
  );
  fs.writeFileSync(path.join(packageDir, "index.js"), "module.exports='sky';\n");
  fs.writeFileSync(path.join(statsigDir, "%24_StatsigGlobal.js"), "module.exports=1;\n");
  fs.writeFileSync(path.join(modulesDir, "client%2Bsession.js"), "module.exports=1;\n");

  assert.deepEqual(normalizeEscapedResourcePaths(root), {
    directories: 2,
    files: 2,
    total: 4,
  });
  assert.equal(
    require.resolve("@oai/sky", { paths: [binDir] }),
    path.join(modulesDir, "@oai", "sky", "index.js"),
  );
  assert.ok(
    fs.existsSync(
      path.join(modulesDir, "@statsig", "client-core", "src", "$_StatsigGlobal.js"),
    ),
  );
  assert.ok(fs.existsSync(path.join(modulesDir, "client+session.js")));
  assert.deepEqual(normalizeEscapedResourcePaths(root), {
    directories: 0,
    files: 0,
    total: 0,
  });
});

test("fails closed when decoding would overwrite an existing entry", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "%40oai"));
  fs.mkdirSync(path.join(root, "@oai"));
  assert.throws(
    () => normalizeEscapedResourcePaths(root),
    /collides with an existing entry/i,
  );
});
