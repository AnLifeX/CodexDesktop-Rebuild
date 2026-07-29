#!/usr/bin/env node
/**
 * Fill zh-CN catalog gaps introduced by newer upstream UI bundles.
 *
 * Upstream can ship new React Intl message descriptors before the matching
 * Simplified Chinese catalog is regenerated. In that case the app correctly
 * falls back to defaultMessage, but the affected settings appear in English.
 * Patch exact message IDs in the exported zh-CN catalog so unrelated strings
 * and other locales remain untouched.
 */
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("acorn");
const { SRC_DIR, relPath } = require("./patch-util");

const ZH_CN_TRANSLATION_SPECS = [
  [
    "composer.mode.agentMode.fullAccessConfirm.files.description",
    "读取、创建、修改、上传或删除此计算机上任何位置的文件",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.files.title",
    "文件和文件夹",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.internet.description",
    "访问网站、发送数据以及使用已启用的插件",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.internet.title",
    "互联网和已连接的应用",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.riskDescription",
    "这可能带来敏感数据丢失或泄露、提示词注入等风险。你可以随时关闭此功能。<link>了解更多</link>",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.terminal.description",
    "运行命令、安装软件和更改系统设置",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.terminal.title",
    "终端命令",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.warningDescription.chatgptMode",
    "ChatGPT 将能够在未经你许可的情况下，在此计算机上的任何位置运行命令、使用互联网，以及创建和编辑文件。包括但不限于：",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.warningDescription.codeMode",
    "Codex 将能够在未经你许可的情况下，在此计算机上的任何位置运行命令、使用互联网，以及创建和编辑文件。包括但不限于：",
  ],
  ["composer.queuedMessage.openInSideChat", "在侧边任务中打开"],
  ["inbox.automations.createWithCodex", "使用 Codex 创建"],
  [
    "localConversation.forkFromOlderTurnDialog.local.label",
    "使用此工作树",
  ],
  [
    "localConversation.forkFromOlderTurnDialog.local.workspaceLabel",
    "使用此工作区",
  ],
  [
    "localConversation.forkFromOlderTurnDialog.worktree.label",
    "使用新工作树",
  ],
  ["projectSetup.createLocalProject.sourceFolderLabel", "源文件夹"],
  ["projectSetup.createLocalProject.sourceFoldersLabel", "源文件夹"],
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
    "打开与当前任务关联的 PR",
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
    "将当前任务复制为 Markdown",
  ],
  ["codex.command.searchChats", "切换任务…"],
  ["codex.commandDescription.searchChats", "搜索并切换到任务"],
  ["codex.command.realtimeVoice", "语音聊天快捷键"],
  ["codex.command.realtimeVoice.endCall", "结束语音聊天"],
  [
    "codex.command.realtimeVoice.toggleMicrophoneMute",
    "切换语音聊天麦克风",
  ],
  ["codex.command.realtimeVoice.toggleOutputMute", "切换语音聊天音频"],
  [
    "codex.commandDescription.realtimeVoice",
    "从桌面任意位置启动语音聊天",
  ],
  [
    "codex.commandDescription.realtimeVoice.endCall",
    "结束当前语音聊天",
  ],
  [
    "codex.commandDescription.realtimeVoice.toggleMicrophoneMute",
    "在语音聊天期间将麦克风静音或取消静音",
  ],
  [
    "codex.commandDescription.realtimeVoice.toggleOutputMute",
    "将语音聊天音频静音或取消静音",
  ],
  ["settings.voice.general", "通用"],
  ["settings.general.microphoneInput.description", "用于语音聊天和听写"],
  ["settings.general.realtimeVoice", "语音聊天"],
  ["settings.general.realtimeVoice.choose", "选择语音"],
  ["settings.general.realtimeVoice.dialog.cancel", "取消"],
  ["settings.general.realtimeVoice.dialog.close", "关闭"],
  ["settings.general.realtimeVoice.dialog.done", "完成"],
  ["settings.general.realtimeVoice.dialog.title", "选择语音"],
  ["settings.general.realtimeVoice.loadError", "无法加载语音设置"],
  ["settings.general.realtimeVoice.loading", "正在加载..."],
  ["settings.general.realtimeVoice.next", "下一个语音"],
  [
    "settings.general.realtimeVoice.noVoices",
    "没有可用的兼容语音",
  ],
  [
    "settings.general.realtimeVoice.optionLabel",
    "{name}：{description}",
  ],
  [
    "settings.general.realtimeVoice.previewPause",
    "暂停 {name} 试听",
  ],
  [
    "settings.general.realtimeVoice.previewPlay",
    "播放 {name} 试听",
  ],
  [
    "settings.general.realtimeVoice.previewReplay",
    "重新播放 {name} 试听",
  ],
  [
    "settings.general.realtimeVoice.previewRetry",
    "重试 {name} 试听",
  ],
  ["settings.general.realtimeVoice.previewUnavailable", "无法试听"],
  ["settings.general.realtimeVoice.previous", "上一个语音"],
  ["settings.general.realtimeVoice.retry", "重试"],
  ["settings.general.realtimeVoice.saveError", "无法保存语音"],
  [
    "settings.general.realtimeVoice.selectedAnnouncement",
    "已选择语音：{name}。{description}",
  ],
  [
    "settings.general.realtimeVoice.voice.arbor.description",
    "轻松随和、灵活多变",
  ],
  [
    "settings.general.realtimeVoice.voice.breeze.description",
    "生动热情、真挚自然",
  ],
  [
    "settings.general.realtimeVoice.voice.cove.description",
    "沉稳直接",
  ],
  [
    "settings.general.realtimeVoice.voice.description",
    "选择 Codex 用于新语音聊天的声音",
  ],
  [
    "settings.general.realtimeVoice.voice.ember.description",
    "自信乐观",
  ],
  [
    "settings.general.realtimeVoice.voice.juniper.description",
    "开朗积极",
  ],
  ["settings.general.realtimeVoice.voice.label", "语音"],
  [
    "settings.general.realtimeVoice.voice.maple.description",
    "愉快坦率",
  ],
  [
    "settings.general.realtimeVoice.voice.sol.description",
    "睿智从容",
  ],
  [
    "settings.general.realtimeVoice.voice.spruce.description",
    "平静肯定",
  ],
  [
    "settings.general.realtimeVoice.voice.vale.description",
    "明快好奇",
  ],
  [
    "settings.general.realtimeVoiceHotkey.captureAriaLabel",
    "语音聊天快捷键录制",
  ],
  [
    "settings.general.realtimeVoiceHotkey.description",
    "从桌面任意位置启动语音聊天",
  ],
  [
    "settings.general.realtimeVoiceHotkey.errorGeneric",
    "更新语音聊天快捷键失败",
  ],
  ["settings.general.realtimeVoiceHotkey.label", "语音聊天快捷键"],
  ["settings.general.realtimeVoiceHotkey.off", "关闭"],
  [
    "settings.general.realtimeVoiceScreenContext.ariaLabel",
    "为语音聊天启用屏幕上下文",
  ],
  [
    "settings.general.realtimeVoiceScreenContext.description",
    "当你提到屏幕上的内容时，允许 Codex 查看前台应用。macOS 会在 Codex 首次需要时请求权限",
  ],
  ["settings.general.realtimeVoiceScreenContext.label", "屏幕上下文"],
];

const ZH_CN_TRANSLATIONS = new Map(ZH_CN_TRANSLATION_SPECS);
if (ZH_CN_TRANSLATIONS.size !== ZH_CN_TRANSLATION_SPECS.length) {
  throw new Error("Duplicate zh-CN translation message ID");
}

function walk(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (node.type) visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child?.type) walk(child, visitor);
      }
    } else if (value?.type) {
      walk(value, visitor);
    }
  }
}

function identifierName(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  return null;
}

function locateCatalogObject(ast) {
  const defaultLocals = [];
  walk(ast, (node) => {
    if (node.type !== "ExportNamedDeclaration") return;
    for (const specifier of node.specifiers ?? []) {
      if (identifierName(specifier.exported) === "default") {
        defaultLocals.push(identifierName(specifier.local));
      }
    }
  });
  const localNames = [...new Set(defaultLocals.filter(Boolean))];
  if (localNames.length !== 1) {
    throw new Error(
      `Expected one zh-CN default export binding, found ${localNames.length}`,
    );
  }

  const candidates = [];
  walk(ast, (node) => {
    if (
      node.type === "AssignmentExpression" &&
      node.operator === "=" &&
      node.left?.type === "Identifier" &&
      node.left.name === localNames[0] &&
      node.right?.type === "ObjectExpression"
    ) {
      candidates.push(node.right);
    }
  });
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one zh-CN catalog object, found ${candidates.length}`,
    );
  }
  return candidates[0];
}

function staticStringValue(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (
    node?.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function templateLiteral(value) {
  return (
    "`" +
    value
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$\{/g, "\\${") +
    "`"
  );
}

function catalogPropertyKey(property) {
  if (property?.type !== "Property" || property.computed) return null;
  return identifierName(property.key);
}

function patchCatalogSource(source, translations = ZH_CN_TRANSLATIONS) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const catalog = locateCatalogObject(ast);
  const properties = new Map();
  for (const property of catalog.properties) {
    const key = catalogPropertyKey(property);
    if (key == null) continue;
    if (properties.has(key)) {
      throw new Error(`Duplicate zh-CN catalog key: ${key}`);
    }
    properties.set(key, property);
  }

  const patches = [];
  const replacements = [];
  const missing = [];
  for (const [messageId, translation] of translations) {
    const property = properties.get(messageId);
    if (!property) {
      missing.push([messageId, translation]);
      replacements.push({ messageId, translation, status: "added" });
      continue;
    }
    const current = staticStringValue(property.value);
    if (current == null) {
      throw new Error(`zh-CN catalog value is not static: ${messageId}`);
    }
    if (current === translation) continue;
    patches.push({
      start: property.value.start,
      end: property.value.end,
      replacement: templateLiteral(translation),
    });
    replacements.push({
      from: current,
      messageId,
      translation,
      status: "updated",
    });
  }

  if (missing.length > 0) {
    const entries = missing
      .map(
        ([messageId, translation]) =>
          `${JSON.stringify(messageId)}:${templateLiteral(translation)}`,
      )
      .join(",");
    patches.push({
      start: catalog.end - 1,
      end: catalog.end - 1,
      replacement: `${catalog.properties.length > 0 ? "," : ""}${entries}`,
    });
  }

  patches.sort((left, right) => right.start - left.start);
  let code = source;
  for (const patch of patches) {
    code =
      code.slice(0, patch.start) +
      patch.replacement +
      code.slice(patch.end);
  }
  return { code, replacements };
}

function platformNames(platform) {
  if (platform === "unix") return ["mac-arm64", "mac-x64"];
  if (platform) return [platform];
  return ["mac-arm64", "mac-x64", "win"].filter((name) =>
    fs.existsSync(path.join(SRC_DIR, name, "_asar", "webview", "assets")),
  );
}

function locateTargets(platform) {
  const targets = [];
  for (const name of platformNames(platform)) {
    const assetsDir = path.join(
      SRC_DIR,
      name,
      "_asar",
      "webview",
      "assets",
    );
    if (!fs.existsSync(assetsDir)) {
      if (platform) throw new Error(`Webview assets are missing: ${assetsDir}`);
      continue;
    }
    const matches = fs
      .readdirSync(assetsDir)
      .filter((file) => /^zh-CN-[A-Za-z0-9_-]+\.js$/.test(file));
    if (matches.length !== 1) {
      throw new Error(
        `Expected one zh-CN catalog for ${name}, found ${matches.length}`,
      );
    }
    targets.push({ platform: name, path: path.join(assetsDir, matches[0]) });
  }
  return targets;
}

function main() {
  const args = process.argv.slice(2);
  const platform = args.find((value) =>
    ["mac-arm64", "mac-x64", "win", "unix"].includes(value),
  );
  const isCheck = args.includes("--check");
  const targets = locateTargets(platform);
  if (targets.length === 0) {
    console.log("  [ok] No zh-CN catalogs found");
    return;
  }

  let total = 0;
  for (const target of targets) {
    const source = fs.readFileSync(target.path, "utf8");
    const result = patchCatalogSource(source);
    total += result.replacements.length;
    console.log(`\n-- [${target.platform}] ${relPath(target.path)}`);
    if (result.replacements.length === 0) {
      console.log("   [ok] zh-CN voice messages already complete");
      continue;
    }
    const added = result.replacements.filter(
      (replacement) => replacement.status === "added",
    ).length;
    const updated = result.replacements.length - added;
    console.log(`   * added ${added}, updated ${updated}`);
    if (!isCheck) {
      fs.writeFileSync(target.path, result.code, "utf8");
      console.log("   [ok] zh-CN voice messages localized");
    }
  }
  if (isCheck) {
    console.log(`\n=> Total patchable zh-CN messages: ${total}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[x] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ZH_CN_TRANSLATIONS,
  ZH_CN_TRANSLATION_SPECS,
  locateTargets,
  patchCatalogSource,
};
