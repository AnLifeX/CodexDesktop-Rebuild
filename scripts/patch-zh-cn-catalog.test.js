#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ZH_CN_FORCED_OVERRIDES,
  ZH_CN_TRANSLATIONS,
  locateTargets,
  patchCatalogSource,
} = require("./patch-zh-cn-catalog");
const { extractCatalogMessages } = require("./audit-zh-cn-catalog");

test("adds missing messages, preserves upstream translations, and applies explicit corrections", () => {
  const fixture = [
    'import{n as e}from"./runtime.js";',
    "var t,n,r,decoy;",
    "e((()=>{",
    "t=`备用`,n=`团队`,",
    'decoy={"voice.existing":`不要修改`},',
    'r={"voice.existing":`上游翻译`,"voice.override":`旧翻译`}',
    "}))();",
    "export{r as default,t as greeting,n as kKSGje};",
  ].join("");
  const translations = new Map([
    ["voice.existing", "新翻译"],
    ["voice.override", "纠正翻译"],
    ["voice.added", "新增翻译"],
  ]);
  const overrides = new Map([["voice.override", "纠正翻译"]]);
  const first = patchCatalogSource(fixture, translations, overrides);

  assert.equal(first.replacements.length, 2);
  assert.match(first.code, /decoy=\{"voice\.existing":`不要修改`\}/);
  assert.match(first.code, /"voice\.existing":`上游翻译`/);
  assert.match(first.code, /"voice\.override":`纠正翻译`/);
  assert.match(first.code, /"voice\.added":`新增翻译`/);

  const second = patchCatalogSource(first.code, translations, overrides);
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

test("translation specs cover fork-from-older-turn action labels", () => {
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
    if (!/^local-conversation-thread-.*\.js$/.test(name)) continue;
    const source = fs.readFileSync(path.join(assetsDir, name), "utf8");
    for (const match of source.matchAll(
      /id:`(localConversation\.forkFromOlderTurnDialog\.(?:local\.(?:label|workspaceLabel)|worktree\.label))`,defaultMessage:`([^`]*)`/g,
    )) {
      required.set(match[1], match[2]);
    }
  }

  assert.equal(required.size, 3, "expected all current fork action labels");
  for (const [messageId, defaultMessage] of required) {
    assert.ok(
      ZH_CN_TRANSLATIONS.has(messageId),
      `missing zh-CN translation: ${messageId} (${defaultMessage})`,
    );
  }
  assert.equal(
    ZH_CN_TRANSLATIONS.get(
      "localConversation.forkFromOlderTurnDialog.local.workspaceLabel",
    ),
    "使用此工作区",
  );
  assert.equal(
    ZH_CN_TRANSLATIONS.get(
      "localConversation.forkFromOlderTurnDialog.worktree.label",
    ),
    "使用新工作树",
  );
});

test("translation specs cover the queued-message side-chat action", () => {
  const assetsDir = path.join(
    __dirname,
    "..",
    "src",
    "win",
    "_asar",
    "webview",
    "assets",
  );
  const descriptors = [];
  for (const name of fs.readdirSync(assetsDir)) {
    if (!/^queued-message-list-.*\.js$/.test(name)) continue;
    const source = fs.readFileSync(path.join(assetsDir, name), "utf8");
    descriptors.push(
      ...source.matchAll(
        /id:`(composer\.queuedMessage\.openInSideChat)`,defaultMessage:`([^`]*)`/g,
      ),
    );
  }

  assert.equal(descriptors.length, 1, "expected the queued side-chat action");
  assert.equal(descriptors[0][2], "Open in side chat");
  assert.equal(
    ZH_CN_TRANSLATIONS.get(descriptors[0][1]),
    "在侧边聊天中打开",
  );
});

test("translation specs cover the confirmed visible UI gaps", () => {
  const expected = new Map([
    ["inbox.automations.createWithCodex", "使用 Codex 创建"],
    ["projectSetup.createLocalProject.sourceFoldersLabel", "源文件夹"],
  ]);
  const assetsDir = path.join(
    __dirname,
    "..",
    "src",
    "win",
    "_asar",
    "webview",
    "assets",
  );
  const currentIds = new Set();
  for (const name of fs.readdirSync(assetsDir)) {
    if (!/^(?:app-initial|automations-page)-.*\.js$/.test(name)) continue;
    const source = fs.readFileSync(path.join(assetsDir, name), "utf8");
    for (const match of source.matchAll(/id:`([^`]+)`,defaultMessage:`[^`]*`/g)) {
      if (expected.has(match[1])) currentIds.add(match[1]);
    }
  }

  assert.deepEqual([...currentIds].sort(), [...expected.keys()].sort());
  for (const [messageId, translation] of expected) {
    assert.equal(ZH_CN_TRANSLATIONS.get(messageId), translation);
  }
});

test("translation specs cover the model picker and import screenshot gaps", () => {
  const expected = new Map([
    ["composer.modelPicker.modelList.open.ariaLabel", "选择模型"],
    ["composer.modelPicker.default.label", "默认"],
    ["composer.modelPicker.default.description", "推荐模型组合"],
    ["serviceTier.ultrafast.description", "为时延敏感型任务提供最快响应"],
    ["settings.import.autosync.paused", "同步已暂停。你的内容选择已保存"],
    ["settings.import.autosync.content", "要同步的内容"],
    ["settings.import.autosync.afterImport", "首次导入后可用"],
    ["settings.import.autosync.customize", "自定义"],
  ]);

  for (const [messageId, translation] of expected) {
    assert.equal(ZH_CN_TRANSLATIONS.get(messageId), translation);
  }
});

test("translation specs cover the injected sidebar delete messages", () => {
  assert.equal(ZH_CN_TRANSLATIONS.get("sidebarElectron.deleteThread"), "删除聊天");
  assert.equal(
    ZH_CN_TRANSLATIONS.get("sidebarElectron.deleteThreadConfirmAction"),
    "确认",
  );
  assert.equal(
    ZH_CN_TRANSLATIONS.get("sidebarElectron.deleteThreadError"),
    "删除聊天失败",
  );
});

test("translation specs cover the confirmed keyboard shortcut rows", () => {
  const expected = new Map([
    ["codex.command.git.createBranch", "创建分支"],
    ["codex.commandDescription.git.createBranch", "打开分支创建选项"],
    ["codex.command.git.createDraftPullRequest", "创建草稿 PR"],
    [
      "codex.commandDescription.git.createDraftPullRequest",
      "打开草稿 PR 创建选项",
    ],
    ["codex.command.git.createPullRequest", "创建 PR"],
    ["codex.commandDescription.git.createPullRequest", "打开 PR 创建选项"],
    ["codex.command.git.mergePullRequest", "合并 PR"],
    ["codex.commandDescription.git.mergePullRequest", "打开 PR 合并选项"],
    ["codex.command.git.openPullRequest", "在 GitHub 上打开 PR"],
    [
      "codex.commandDescription.git.openPullRequest",
      "打开与当前聊天关联的 PR",
    ],
    ["codex.command.redoAppAction", "重做上一步操作"],
    [
      "codex.commandDescription.redoAppAction",
      "重做最近撤销的应用操作",
    ],
    ["codex.command.settings", "设置"],
    ["codex.commandDescription.settings", "打开 {appName} 设置"],
    ["codex.command.undoAppAction", "撤销上一步操作"],
    ["codex.commandDescription.undoAppAction", "撤销最近一次应用操作"],
    ["codex.command.composer.openProjectPicker", "打开项目选择器"],
    [
      "codex.commandDescription.composer.openProjectPicker",
      "打开当前输入框的项目选择器",
    ],
    ["codex.command.composer.startDictation", "开始听写"],
    [
      "codex.commandDescription.composer.startDictation",
      "在当前输入框中开始听写",
    ],
    ["codex.command.composer.startVoiceMode", "切换语音模式"],
    [
      "codex.commandDescription.composer.startVoiceMode",
      "开始或停止语音聊天",
    ],
    ["codex.command.composer.submit", "发送消息"],
    [
      "codex.commandDescription.composer.submit",
      "发送当前输入框中的消息",
    ],
    ["codex.command.composer.toggleFastMode", "切换快速模式"],
    [
      "codex.commandDescription.composer.toggleFastMode",
      "在当前输入框中开启或关闭快速模式",
    ],
    ["codex.command.composer.togglePlanMode", "切换规划模式"],
    [
      "codex.commandDescription.composer.togglePlanMode",
      "在当前输入框中开启或关闭规划模式",
    ],
    ["codex.command.composer.toggleWorktreeMode", "切换本地/工作树"],
    [
      "codex.commandDescription.composer.toggleWorktreeMode",
      "将当前输入框切换到本地模式或新工作树",
    ],
    ["codex.command.copyConversationMarkdown", "复制为 Markdown"],
    [
      "codex.commandDescription.copyConversationMarkdown",
      "将当前聊天复制为 Markdown",
    ],
    ["codex.command.searchChats", "切换聊天…"],
    ["codex.commandDescription.searchChats", "搜索并切换到聊天"],
  ]);
  const assetsDir = path.join(
    __dirname,
    "..",
    "src",
    "win",
    "_asar",
    "webview",
    "assets",
  );
  const currentIds = new Set();
  for (const name of fs.readdirSync(assetsDir)) {
    if (!/^app-initial-.*\.js$/.test(name)) continue;
    const source = fs.readFileSync(path.join(assetsDir, name), "utf8");
    for (const match of source.matchAll(/id:`([^`]+)`,defaultMessage:`[^`]*`/g)) {
      if (expected.has(match[1])) currentIds.add(match[1]);
    }
  }

  assert.deepEqual([...currentIds].sort(), [...expected.keys()].sort());
  for (const [messageId, translation] of expected) {
    assert.equal(ZH_CN_TRANSLATIONS.get(messageId), translation);
  }
});

test("patches the extracted Windows zh-CN catalog in memory", () => {
  const targets = locateTargets("win");
  assert.equal(targets.length, 1);
  const source = fs.readFileSync(targets[0].path, "utf8");
  const localized = patchCatalogSource(source).code;
  const before = extractCatalogMessages(source);
  const after = extractCatalogMessages(localized);
  for (const [messageId, translation] of ZH_CN_TRANSLATIONS) {
    const expected = before.has(messageId)
      ? (ZH_CN_FORCED_OVERRIDES.get(messageId) ?? before.get(messageId))
      : translation;
    assert.equal(
      after.get(messageId),
      expected,
      `catalog has an unexpected localized message: ${messageId}`,
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
