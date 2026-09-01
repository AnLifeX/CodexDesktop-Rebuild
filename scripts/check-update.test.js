#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.join(__dirname, "..");

test("version detection does not create or read ephemeral local state", () => {
  for (const relativePath of ["scripts/check-update.js", "scripts/sync-upstream.js"]) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /\.versions\.json|VERSION_FILE|loadVersions|saveVersions/);
  }

  const gitignore = fs.readFileSync(path.join(projectRoot, ".gitignore"), "utf8");
  assert.doesNotMatch(gitignore, /scripts\/\.versions\.json/);
});
