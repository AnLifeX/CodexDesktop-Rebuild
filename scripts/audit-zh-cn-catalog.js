#!/usr/bin/env node
/**
 * Audit static React Intl messages that are absent from the zh-CN catalog.
 *
 * Usage:
 *   node scripts/audit-zh-cn-catalog.js win
 *   node scripts/audit-zh-cn-catalog.js win --include-patched
 *   node scripts/audit-zh-cn-catalog.js win --scope core
 *   node scripts/audit-zh-cn-catalog.js win --output out/zh-cn-missing.md
 *   node scripts/audit-zh-cn-catalog.js win --json
 */
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("acorn");
const {
  ZH_CN_TRANSLATIONS,
  locateTargets: locateCatalogTargets,
} = require("./patch-zh-cn-catalog");
const { SRC_DIR, relPath } = require("./patch-util");

const PLATFORMS = ["mac-arm64", "mac-x64", "win"];
const CORE_UI_PATTERNS = [
  /^appUpdate\.relaunchNotice\./,
  /^chart\.tooltip\.moreEntries$/,
  /^codex\.(?:command(?:Description)?\.switchTo(?:Chat|Codex|Work)|composer\.imageAttachment|diffView\.|rateLimitResetPromptModal\.|threadFindBar\.|unifiedDiff\.)/,
  /^codex\.commandDescription\.openSideChat$/,
  /^composer\.(?:atMentionList|browserTabMentions|existingWorktree|footer\.branchSwitch|newSlashCommand|reviewMode|runLocation|submit|workMode)\./,
  /^imageAttachment\.editImage$/,
  /^localConversation\.(?:conversationOptimi|loading|subagentsPanel|threadHandoff|userInputRequest)/,
  /^projectsIndex\.chatGpt\.(?:pin|unpin)Project$/,
  /^pullRequestDetail\.description\./,
  /^settings\.(?:general\.inAppUpdates|import\.history|usage\.)/,
  /^sidebarElectron\.(?:chatsSortMenu|newThreadInConnection|pinnedThreads|priorityThreads|productMode|projectHoverCard|removeRemoteProject|skillsAppsRouteNavLink)/,
  /^sidebarOnboardingChecklist\./,
  /^threadPage\.runAction\./,
];

function walk(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (node.type) visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end") continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child?.type) walk(child, visitor);
      }
    } else if (value?.type) {
      walk(value, visitor);
    }
  }
}

function staticString(node) {
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

function propertyName(property) {
  if (property?.type !== "Property" || property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  return staticString(property.key);
}

function objectStaticProperty(object, name) {
  const matches = object.properties.filter(
    (property) => propertyName(property) === name,
  );
  if (matches.length !== 1) return null;
  return staticString(matches[0].value);
}

function sourceLineStarts(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function sourcePosition(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle;
  }
  return {
    line: low + 1,
    column: offset - lineStarts[low] + 1,
    offset,
  };
}

function parseModule(source, label) {
  try {
    return parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowHashBang: true,
    });
  } catch (error) {
    throw new Error(`${label} parse failed: ${error.message}`);
  }
}

function extractMessageDescriptors(source, fileName = "<source>") {
  const ast = parseModule(source, fileName);
  const lineStarts = sourceLineStarts(source);
  const descriptors = [];
  walk(ast, (node) => {
    if (node.type !== "ObjectExpression") return;
    const id = objectStaticProperty(node, "id");
    const defaultMessage = objectStaticProperty(node, "defaultMessage");
    if (id == null || defaultMessage == null) return;
    descriptors.push({
      id,
      defaultMessage,
      fileName,
      ...sourcePosition(lineStarts, node.start),
    });
  });
  return descriptors;
}

function exportedDefaultBinding(ast) {
  const names = [];
  walk(ast, (node) => {
    if (node.type !== "ExportNamedDeclaration") return;
    for (const specifier of node.specifiers ?? []) {
      const exported = specifier.exported?.name ?? specifier.exported?.value;
      const local = specifier.local?.name ?? specifier.local?.value;
      if (exported === "default" && typeof local === "string") names.push(local);
    }
  });
  const unique = [...new Set(names)];
  if (unique.length !== 1) {
    throw new Error(`zh-CN catalog expected one default binding, found ${unique.length}`);
  }
  return unique[0];
}

function extractCatalogMessages(source, fileName = "<zh-CN catalog>") {
  const ast = parseModule(source, fileName);
  const binding = exportedDefaultBinding(ast);
  const objects = [];
  walk(ast, (node) => {
    if (
      node.type === "AssignmentExpression" &&
      node.operator === "=" &&
      node.left?.type === "Identifier" &&
      node.left.name === binding &&
      node.right?.type === "ObjectExpression"
    ) {
      objects.push(node.right);
    }
  });
  if (objects.length !== 1) {
    throw new Error(`zh-CN catalog expected one object, found ${objects.length}`);
  }

  const messages = new Map();
  for (const property of objects[0].properties) {
    const id = propertyName(property);
    if (id == null) continue;
    const translation = staticString(property.value);
    if (messages.has(id)) throw new Error(`duplicate zh-CN catalog key: ${id}`);
    messages.set(id, translation);
  }
  return messages;
}

function collectAssetDescriptors(assetsDir) {
  const descriptors = [];
  let parsedFiles = 0;
  for (const fileName of fs.readdirSync(assetsDir).sort()) {
    if (!fileName.endsWith(".js")) continue;
    const filePath = path.join(assetsDir, fileName);
    const source = fs.readFileSync(filePath, "utf8");
    if (!source.includes("defaultMessage")) continue;
    parsedFiles += 1;
    descriptors.push(...extractMessageDescriptors(source, fileName));
  }
  return { descriptors, parsedFiles };
}

function inferArea(id, files) {
  const rules = [
    [/^composer\.queuedMessage\./, "输入框 → 排队消息"],
    [/^composer\./, "输入框/消息编辑器"],
    [/^sidebarElectron\./, "主侧边栏"],
    [/^localConversation\.forkFromOlderTurnDialog\./, "消息菜单 → 从此消息继续"],
    [/^localConversation\.sideChat\./, "侧边任务"],
    [/^localConversation\./, "本地任务/对话"],
    [/^threadHeader\./, "任务页顶部"],
    [/^thread\.sidePanel\./, "任务侧栏"],
    [/^threadPage\./, "任务页"],
    [/^selectedTextOverlay\./, "选中文本浮层"],
    [/^settings\./, "设置"],
    [/^codex\.commandDescription\./, "命令面板 → 命令说明"],
    [/^codex\.command\./, "命令面板/快捷键"],
    [/^workspaceRootDialog\./, "项目/工作区选择"],
    [/worktree/i, "工作树"],
    [/archive/i, "归档"],
    [/diff/i, "差异视图"],
  ];
  for (const [pattern, area] of rules) {
    if (pattern.test(id)) return area;
  }
  const firstFile = files[0]?.fileName ?? "";
  return firstFile.replace(/-[A-Za-z0-9_-]+\.js$/, "") || "其他/待确认";
}

function consolidateDescriptors(descriptors) {
  const byId = new Map();
  for (const descriptor of descriptors) {
    let record = byId.get(descriptor.id);
    if (record == null) {
      record = { id: descriptor.id, defaults: new Set(), sources: [] };
      byId.set(descriptor.id, record);
    }
    record.defaults.add(descriptor.defaultMessage);
    if (
      !record.sources.some(
        (source) =>
          source.fileName === descriptor.fileName &&
          source.offset === descriptor.offset,
      )
    ) {
      record.sources.push({
        fileName: descriptor.fileName,
        line: descriptor.line,
        column: descriptor.column,
        offset: descriptor.offset,
      });
    }
  }

  const records = [];
  const conflicts = [];
  for (const record of byId.values()) {
    const defaults = [...record.defaults].sort();
    const normalized = {
      id: record.id,
      defaultMessage: defaults[0],
      sources: record.sources.sort((left, right) =>
        left.fileName.localeCompare(right.fileName) || left.offset - right.offset,
      ),
    };
    normalized.area = inferArea(normalized.id, normalized.sources);
    if (defaults.length > 1) {
      conflicts.push({ ...normalized, defaultMessages: defaults });
    } else {
      records.push(normalized);
    }
  }
  records.sort(
    (left, right) =>
      left.area.localeCompare(right.area, "zh-CN") ||
      left.id.localeCompare(right.id),
  );
  conflicts.sort((left, right) => left.id.localeCompare(right.id));
  return { records, conflicts };
}

function isLikelyEnglishFallback(value) {
  return /[A-Za-z]/.test(value) && !/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u.test(value);
}

function isCoreUiCandidate(record) {
  return CORE_UI_PATTERNS.some((pattern) => pattern.test(record.id));
}

function auditPlatform(platform = "win", options = {}) {
  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`webview assets are missing: ${assetsDir}`);
  }
  const catalogTargets = locateCatalogTargets(platform);
  if (catalogTargets.length !== 1) {
    throw new Error(`expected one zh-CN catalog for ${platform}`);
  }
  const catalogPath = catalogTargets[0].path;
  const catalog = extractCatalogMessages(
    fs.readFileSync(catalogPath, "utf8"),
    path.basename(catalogPath),
  );
  const collected = collectAssetDescriptors(assetsDir);
  const consolidated = consolidateDescriptors(collected.descriptors);
  const planned = options.plannedTranslations ?? ZH_CN_TRANSLATIONS;
  const missing = [];
  const nonEnglishFallbacks = [];
  const patched = [];
  const localized = [];
  for (const record of consolidated.records) {
    if (catalog.has(record.id)) {
      localized.push(record);
    } else if (planned.has(record.id)) {
      patched.push({ ...record, plannedTranslation: planned.get(record.id) });
    } else if (!isLikelyEnglishFallback(record.defaultMessage)) {
      nonEnglishFallbacks.push(record);
    } else {
      missing.push(record);
    }
  }
  return {
    platform,
    assetsDir,
    catalogPath,
    parsedFiles: collected.parsedFiles,
    descriptorOccurrences: collected.descriptors.length,
    uniqueDescriptors: consolidated.records.length + consolidated.conflicts.length,
    localized,
    patched,
    missing,
    nonEnglishFallbacks,
    conflicts: consolidated.conflicts,
  };
}

function markdownCell(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function formatSource(source) {
  return `${source.fileName}:${source.line}:${source.column} (offset ${source.offset})`;
}

function formatMarkdown(report, options = {}) {
  let records = options.includePatched
    ? [...report.missing, ...report.patched].sort(
        (left, right) =>
          left.area.localeCompare(right.area, "zh-CN") ||
          left.id.localeCompare(right.id),
      )
    : report.missing;
  if (options.scope === "core") records = records.filter(isCoreUiCandidate);
  const lines = [
    `# ${report.platform} zh-CN 缺失文案审计`,
    "",
    `- 扫描含消息描述符的分包：${report.parsedFiles}`,
    `- 静态消息描述符：${report.uniqueDescriptors} 个唯一 ID（${report.descriptorOccurrences} 处）`,
    `- 中文目录已有：${report.localized.length}`,
    `- 已由补丁计划补入：${report.patched.length}`,
    `- 目录缺失但默认文案已非英文：${report.nonEnglishFallbacks.length}`,
    `- 英文待人工验证：${report.missing.length}`,
    `- 本报告显示：${records.length}（范围：${options.scope ?? "all"}）`,
    `- 同 ID 英文冲突：${report.conflicts.length}`,
    "",
    "“界面区域”为根据 message ID 推断；源文件位置来自压缩分包，通常都在第 1 行。",
    "",
    "| # | 推断界面区域 | 英文原文 | Message ID | 源文件位置 |",
    "|---:|---|---|---|---|",
  ];
  records.forEach((record, index) => {
    const sources = record.sources.map(formatSource).join("<br>");
    const planned = record.plannedTranslation
      ? `<br>计划译文：${record.plannedTranslation}`
      : "";
    lines.push(
      `| ${index + 1} | ${markdownCell(record.area)} | ${markdownCell(record.defaultMessage)}${markdownCell(planned)} | ` +
        `\`${markdownCell(record.id)}\` | ${markdownCell(sources)} |`,
    );
  });
  if (report.conflicts.length > 0) {
    lines.push("", "## 同 ID 英文冲突", "");
    for (const conflict of report.conflicts) {
      lines.push(
        `- \`${conflict.id}\`: ${conflict.defaultMessages.map((value) => JSON.stringify(value)).join(" / ")}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(args) {
  const platform = args.find((value) => PLATFORMS.includes(value)) ?? "win";
  const outputIndex = args.indexOf("--output");
  if (outputIndex !== -1 && args[outputIndex + 1] == null) {
    throw new Error("--output requires a path");
  }
  return {
    platform,
    includePatched: args.includes("--include-patched"),
    json: args.includes("--json"),
    scope: args.includes("--scope")
      ? args[args.indexOf("--scope") + 1]
      : "all",
    output: outputIndex === -1 ? null : args[outputIndex + 1],
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!["all", "core"].includes(options.scope)) {
    throw new Error(`unsupported audit scope: ${options.scope}`);
  }
  const report = auditPlatform(options.platform);
  const rendered = options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatMarkdown(report, options);
  if (options.output == null) {
    process.stdout.write(rendered);
    return;
  }
  const outputPath = path.resolve(options.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered, "utf8");
  const displayed = options.scope === "core"
    ? report.missing.filter(isCoreUiCandidate).length
    : report.missing.length;
  console.log(`Wrote ${displayed} candidates to ${relPath(outputPath)}`);
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
  auditPlatform,
  collectAssetDescriptors,
  consolidateDescriptors,
  extractCatalogMessages,
  extractMessageDescriptors,
  formatMarkdown,
  inferArea,
  isCoreUiCandidate,
  isLikelyEnglishFallback,
  parseArgs,
};
