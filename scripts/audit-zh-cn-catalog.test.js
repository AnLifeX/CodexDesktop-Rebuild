#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  auditPlatform,
  consolidateDescriptors,
  extractCatalogMessages,
  extractMessageDescriptors,
  formatMarkdown,
  isCoreUiCandidate,
  isLikelyEnglishFallback,
} = require("./audit-zh-cn-catalog");

test("extracts static descriptors regardless of property order", () => {
  const source = [
    "const a={id:`composer.first`,defaultMessage:`First`};",
    "const b={defaultMessage:'Second',description:'help',id:'sidebarElectron.second'};",
    "const dynamic={id:name,defaultMessage:`Skip`};",
  ].join("");
  assert.deepEqual(
    extractMessageDescriptors(source, "fixture.js").map(
      ({ id, defaultMessage, fileName }) => ({ id, defaultMessage, fileName }),
    ),
    [
      { id: "composer.first", defaultMessage: "First", fileName: "fixture.js" },
      {
        id: "sidebarElectron.second",
        defaultMessage: "Second",
        fileName: "fixture.js",
      },
    ],
  );
});

test("extracts the default-exported locale catalog", () => {
  const source = [
    "var greeting,catalog;",
    "init((()=>{greeting=`你好`,catalog={\"composer.first\":`第一项`,greeting}}))();",
    "export{catalog as default,greeting as greeting};",
  ].join("");
  assert.deepEqual(
    [...extractCatalogMessages(source, "zh-CN.js")],
    [["composer.first", "第一项"], ["greeting", null]],
  );
});

test("consolidates duplicate occurrences and reports conflicting defaults", () => {
  const descriptors = [
    { id: "same", defaultMessage: "Same", fileName: "a.js", line: 1, column: 1, offset: 0 },
    { id: "same", defaultMessage: "Same", fileName: "b.js", line: 1, column: 2, offset: 1 },
    { id: "conflict", defaultMessage: "One", fileName: "a.js", line: 1, column: 3, offset: 2 },
    { id: "conflict", defaultMessage: "Two", fileName: "b.js", line: 1, column: 4, offset: 3 },
  ];
  const result = consolidateDescriptors(descriptors);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].sources.length, 2);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0].defaultMessages, ["One", "Two"]);
});

test("keeps only English fallbacks in the manual verification queue", () => {
  assert.equal(isLikelyEnglishFallback("Open in side chat"), true);
  assert.equal(isLikelyEnglishFallback("打开 side chat"), false);
  assert.equal(isLikelyEnglishFallback("关闭标签页"), false);
});

test("core scope prioritizes current composer, thread, and sidebar surfaces", () => {
  assert.equal(isCoreUiCandidate({ id: "composer.browserTabMentions.limitExceeded" }), true);
  assert.equal(isCoreUiCandidate({ id: "localConversation.loadingTask" }), true);
  assert.equal(isCoreUiCandidate({ id: "sidebarElectron.priorityThreads.emptyState" }), true);
  assert.equal(isCoreUiCandidate({ id: "codex.diffView.applyPatchError" }), true);
  assert.equal(isCoreUiCandidate({ id: "settings.general.inAppUpdates.label" }), true);
  assert.equal(isCoreUiCandidate({ id: "settings.experimental.hidden" }), false);
});

test("formats full candidate evidence as Markdown", () => {
  const markdown = formatMarkdown({
    platform: "win",
    parsedFiles: 1,
    uniqueDescriptors: 2,
    descriptorOccurrences: 2,
    localized: [{}],
    patched: [],
    nonEnglishFallbacks: [],
    missing: [
      {
        area: "输入框 → 排队消息",
        defaultMessage: "Open | inspect",
        id: "composer.missing",
        sources: [{ fileName: "queue.js", line: 1, column: 5, offset: 4 }],
      },
    ],
    conflicts: [],
  });
  assert.match(markdown, /英文待人工验证：1/);
  assert.match(markdown, /本报告显示：1（范围：all）/);
  assert.match(markdown, /Open \\| inspect/);
  assert.match(markdown, /queue\.js:1:5 \(offset 4\)/);
});

test("audits the current extracted Windows catalog", () => {
  const report = auditPlatform("win");
  assert.ok(report.parsedFiles > 100);
  assert.ok(report.uniqueDescriptors > 1000);
  assert.ok(report.localized.length > 1000);
  assert.ok(
    [...report.localized, ...report.patched].some(
      (item) => item.id === "composer.queuedMessage.openInSideChat",
    ),
  );
  assert.ok(!report.missing.some((item) => item.id === "composer.queuedMessage.openInSideChat"));
  assert.ok(fs.existsSync(report.catalogPath));
  assert.equal(path.basename(report.catalogPath).startsWith("zh-CN-"), true);
});
