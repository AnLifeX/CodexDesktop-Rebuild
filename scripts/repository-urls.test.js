#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const repositoryUrl = "https://github.com/anlifex/CodexDesktop-Rebuild";
const updateFeedUrl = `${repositoryUrl}/releases/download/windows-update-feed`;
const legacyOwner = ["Gaq", "152"].join("");

const projectUrlFiles = [
  ".github/workflows/build.yml",
  ".github/workflows/promote-windows-release.yml",
  ".github/workflows/sync.yml",
  "README.md",
  "forge.config.js",
  "package.json",
  "scripts/build-win-installer.js",
  "scripts/patch-local-updater.js",
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("project-owned repository URLs use the current GitHub owner", () => {
  for (const relativePath of projectUrlFiles) {
    const text = read(relativePath);
    assert.doesNotMatch(text, new RegExp(legacyOwner, "i"), `${relativePath} contains the former owner`);
    assert.match(
      text,
      /(?:github\.com|raw\.githubusercontent\.com)\/anlifex\/CodexDesktop-Rebuild/i,
      `${relativePath} lacks the current repository URL`,
    );
  }
});

test("all Windows update entry points use the current release feed", () => {
  for (const relativePath of [
    ".github/workflows/build.yml",
    ".github/workflows/promote-windows-release.yml",
    ".github/workflows/sync.yml",
    "package.json",
    "scripts/patch-local-updater.js",
  ]) {
    assert.ok(read(relativePath).includes(updateFeedUrl), `${relativePath} has a stale Windows update feed`);
  }
});

test("package metadata points users back to the current project", () => {
  const metadata = JSON.parse(read("package.json"));
  assert.equal(metadata.homepage, repositoryUrl);
  assert.equal(metadata.repository?.url, `git+${repositoryUrl}.git`);
  assert.equal(metadata.bugs?.url, `${repositoryUrl}/issues`);
});
