#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ZH_CN_TRANSLATIONS,
  locateTargets,
  patchCatalogSource,
} = require("./patch-zh-cn-catalog");

test("adds missing catalog messages and refreshes stale translations", () => {
  const fixture = [
    'import{n as e}from"./runtime.js";',
    "var t,n,r,decoy;",
    "e((()=>{",
    "t=`备用`,n=`团队`,",
    'decoy={"voice.existing":`不要修改`},',
    'r={"voice.existing":`旧翻译`}',
    "}))();",
    "export{r as default,t as greeting,n as kKSGje};",
  ].join("");
  const translations = new Map([
    ["voice.existing", "新翻译"],
    ["voice.added", "新增翻译"],
  ]);
  const first = patchCatalogSource(fixture, translations);

  assert.equal(first.replacements.length, 2);
  assert.match(first.code, /decoy=\{"voice\.existing":`不要修改`\}/);
  assert.match(first.code, /"voice\.existing":`新翻译`/);
  assert.match(first.code, /"voice\.added":`新增翻译`/);

  const second = patchCatalogSource(first.code, translations);
  assert.equal(second.code, first.code);
  assert.equal(second.replacements.length, 0);
});

test("fails closed when the default catalog export is missing", () => {
  assert.throws(
    () =>
      patchCatalogSource(
        "var a={};export{a as other};",
        new Map(),
      ),
    /Expected one zh-CN default export binding/,
  );
});

test("translation specs cover current voice settings and shortcut messages", () => {
  const assetsDir = path.join(
    __dirname,
    "..",
    "src",
    "win",
    "_asar",
    "webview",
    "assets",
  );
  const required = new Map();
  for (const name of fs.readdirSync(assetsDir)) {
    if (!/^(?:app-initial|voice-settings)-.*\.js$/.test(name)) continue;
    const source = fs.readFileSync(path.join(assetsDir, name), "utf8");
    for (const match of source.matchAll(
      /id:`([^`]+)`,defaultMessage:`([^`]*)`/g,
    )) {
      const [, messageId, defaultMessage] = match;
      if (
        messageId.startsWith("codex.command.realtimeVoice") ||
        messageId.startsWith("codex.commandDescription.realtimeVoice") ||
        messageId.startsWith("settings.general.realtimeVoice") ||
        messageId === "settings.general.microphoneInput.description" ||
        messageId === "settings.voice.general"
      ) {
        required.set(messageId, defaultMessage);
      }
    }
  }

  assert.ok(required.size > 40, "expected the current realtime voice catalog");
  for (const [messageId, defaultMessage] of required) {
    assert.ok(
      ZH_CN_TRANSLATIONS.has(messageId),
      `missing zh-CN translation: ${messageId} (${defaultMessage})`,
    );
  }
});

test("patches the extracted Windows zh-CN catalog in memory", () => {
  const targets = locateTargets("win");
  assert.equal(targets.length, 1);
  const source = fs.readFileSync(targets[0].path, "utf8");
  const localized = patchCatalogSource(source).code;
  for (const [messageId, translation] of ZH_CN_TRANSLATIONS) {
    assert.ok(
      localized.includes(`${JSON.stringify(messageId)}:\`${translation}\``),
      `catalog is missing localized message: ${messageId}`,
    );
  }
});

test("standard patch pipeline applies catalog messages before menu patches", () => {
  const patchAll = fs.readFileSync(path.join(__dirname, "patch-all.js"), "utf8");
  assert.match(patchAll, /"patch-zh-cn-catalog\.js"/);
  assert.ok(
    patchAll.indexOf('"patch-i18n.js"') <
      patchAll.indexOf('"patch-zh-cn-catalog.js"'),
  );
  assert.ok(
    patchAll.indexOf('"patch-zh-cn-catalog.js"') <
      patchAll.indexOf('"patch-native-menu-i18n.js"'),
  );
});
