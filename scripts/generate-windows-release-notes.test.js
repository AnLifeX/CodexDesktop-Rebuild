#!/usr/bin/env node
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  renderReleaseNotes,
  selectOfficialUpdates,
  versionFamily,
} = require("./generate-windows-release-notes");

function feed(items) {
  return { schemaVersion: 1, feed: "codex-app", items };
}

function item({ date, version = null, title = "Update", summary = "Summary" }) {
  return {
    date,
    version,
    title,
    summary,
    topics: ["codex-app"],
    url: `https://developers.openai.com/codex/changelog#${date}`,
  };
}

test("release families match the official app changelog convention", () => {
  assert.equal(versionFamily("26.825.41651"), "26.825");
  assert.equal(versionFamily("invalid"), null);
});

test("exact official version-family entries take priority", () => {
  const result = selectOfficialUpdates(
    feed([
      item({ date: "2026-08-25", title: "Recent" }),
      item({ date: "2026-07-30", version: "26.727, 26.825", title: "Exact" }),
    ]),
    { appVersion: "26.825.41651", previousUpdatedAt: "2026-08-20T00:00:00Z" },
  );
  assert.equal(result.kind, "exact");
  assert.deepEqual(result.items.map((entry) => entry.title), ["Exact"]);
});

test("recent official app entries are used without pretending they match a build", () => {
  const result = selectOfficialUpdates(
    feed([
      item({ date: "2026-08-25", title: "New app update" }),
      { ...item({ date: "2026-08-24", title: "CLI only" }), topics: ["codex-cli"] },
      item({ date: "2026-08-19", title: "Old app update" }),
    ]),
    { appVersion: "26.825.41651", previousUpdatedAt: "2026-08-20T12:00:00Z" },
  );
  assert.equal(result.kind, "recent");
  assert.deepEqual(result.items.map((entry) => entry.title), ["New app update"]);
});

test("rendered notes contain trustworthy metadata, downloads, and the hidden run marker", () => {
  const notes = renderReleaseNotes({
    appVersion: "26.825.41651",
    msixVersion: "26.825.5331.0",
    cliVersion: "0.151.0-alpha.7.2",
    releaseVersion: "26.825.41651",
    portableName: "Codex-win-x64-26.825.41651.zip",
    installerName: "CodexSetup-win-x64-26.825.41651.zip",
    sourceRunId: "123456",
    officialUpdates: {
      kind: "recent",
      items: [item({ date: "2026-08-25", title: "Browser update" })],
    },
  });

  assert.match(notes, /## 版本信息/);
  assert.match(notes, /OpenAI 没有为此内部构建号提供一一对应的更新说明/);
  assert.match(notes, /## AnLifeX 构建更新/);
  assert.match(notes, /多版本残差链/);
  assert.match(notes, /<!-- codex-rebuild-run-id:123456 -->/);
  assert.doesNotMatch(notes, /remains a draft|仍是草稿/i);
});
