#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  parseArgs,
  updatePackageVersion,
  validateVersion,
  writeGithubOutput,
} = require("./configure-codex-cli-version");

test("accepts exact stable and prerelease official Codex versions", () => {
  assert.equal(validateVersion("0.146.0"), "0.146.0");
  assert.equal(validateVersion("0.146.0-alpha.3.1"), "0.146.0-alpha.3.1");
});

test("rejects ranges, tags, and malformed versions", () => {
  for (const version of ["latest", "^0.146.0", "0.146", "0.146.0 alpha.3.1"]) {
    assert.throws(() => validateVersion(version), /invalid version/);
  }
});

test("updates only the exact optional dependency", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-cli-version-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageFile = path.join(root, "package.json");
  fs.writeFileSync(packageFile, JSON.stringify({
    name: "fixture",
    optionalDependencies: { other: "1.0.0", "@openai/codex": "0.144.1" },
  }));

  updatePackageVersion(packageFile, "0.146.0-alpha.3.1");
  const updated = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  assert.deepEqual(updated.optionalDependencies, {
    other: "1.0.0",
    "@openai/codex": "0.146.0-alpha.3.1",
  });
});

test("writes the reusable GitHub Actions output", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-cli-output-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "output.txt");
  writeGithubOutput("0.146.0-alpha.3.1", output);
  assert.equal(fs.readFileSync(output, "utf8"), "codex_cli_version=0.146.0-alpha.3.1\n");
});

test("requires exactly one version source", () => {
  assert.throws(() => parseArgs([]), /Exactly one/);
  assert.throws(
    () => parseArgs(["--binary", "codex.exe", "--version", "0.146.0"]),
    /Exactly one/,
  );
});
