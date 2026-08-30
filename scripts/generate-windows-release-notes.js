#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const OFFICIAL_CHANGELOG_URL = "https://developers.openai.com/codex/changelog";
const OFFICIAL_CHANGELOG_FEED = "https://learn.chatgpt.com/docs/changelog/codex-app.json";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return "";
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function requiredValue(args, name) {
  const value = valueAfter(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function versionFamily(version) {
  const match = String(version || "").match(/^(\d+)\.(\d+)(?:\.|$)/);
  return match ? `${Number(match[1])}.${Number(match[2])}` : null;
}

function declaredVersionFamilies(value) {
  return String(value || "")
    .split(",")
    .map((item) => versionFamily(item.trim()))
    .filter(Boolean);
}

function isCodexAppItem(item) {
  return item &&
    typeof item.title === "string" &&
    typeof item.date === "string" &&
    Array.isArray(item.topics) &&
    item.topics.includes("codex-app");
}

function utcDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function selectOfficialUpdates(feed, { appVersion, previousUpdatedAt, limit = 3 } = {}) {
  if (!feed || feed.schemaVersion !== 1 || feed.feed !== "codex-app" || !Array.isArray(feed.items)) {
    throw new Error("Official Codex changelog feed has an unexpected schema");
  }

  const family = versionFamily(appVersion);
  const appItems = feed.items.filter(isCodexAppItem);
  const exact = family
    ? appItems.filter((item) => declaredVersionFamilies(item.version).includes(family))
    : [];
  if (exact.length > 0) {
    return { kind: "exact", items: exact.slice(0, limit) };
  }

  const previous = utcDate(previousUpdatedAt);
  if (!previous) return { kind: "none", items: [] };
  const previousDay = previous.toISOString().slice(0, 10);
  const recent = appItems
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && item.date >= previousDay)
    .slice(0, limit);
  return recent.length > 0
    ? { kind: "recent", items: recent }
    : { kind: "none", items: [] };
}

function singleLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function markdownLinkText(value) {
  return singleLine(value).replace(/([\\\[\]])/g, "\\$1");
}

function renderOfficialItem(item) {
  const title = markdownLinkText(item.title);
  const url = /^https:\/\//.test(item.url || "") ? item.url : OFFICIAL_CHANGELOG_URL;
  const summary = singleLine(item.summary);
  return `- \`${item.date}\` [${title}](${url})${summary ? ` — ${summary}` : ""}`;
}

function renderReleaseNotes(options) {
  const {
    appVersion,
    msixVersion,
    cliVersion,
    releaseVersion,
    portableName,
    installerName,
    sourceRunId,
    officialUpdates = { kind: "none", items: [] },
  } = options;

  const lines = [
    "## 版本信息",
    "",
    `- Codex App：\`${appVersion}\``,
    `- Microsoft Store 包：\`${msixVersion}\``,
    `- Codex CLI：[\`${cliVersion}\`](https://github.com/openai/codex/releases/tag/rust-v${encodeURIComponent(cliVersion)})`,
    `- AnLifeX 发布版本：\`${releaseVersion}\``,
    "",
    "## 官方更新",
    "",
  ];

  if (officialUpdates.kind === "exact") {
    lines.push("以下条目由 OpenAI 标注为当前版本系列的更新：", "");
    lines.push(...officialUpdates.items.map(renderOfficialItem));
  } else if (officialUpdates.kind === "recent") {
    lines.push(
      "OpenAI 没有为此内部构建号提供一一对应的更新说明；以下是自上次发布以来的官方近期更新：",
      "",
    );
    lines.push(...officialUpdates.items.map(renderOfficialItem));
  } else {
    lines.push("OpenAI 没有为此内部构建号提供独立更新条目。");
  }

  lines.push(
    "",
    `- [查看 OpenAI Codex 完整更新日志](${OFFICIAL_CHANGELOG_URL})`,
    "",
    "## AnLifeX 构建更新",
    "",
    `- 同步官方 Windows x64 Codex App \`${appVersion}\`。`,
    `- 内置与官方包匹配的 Codex CLI \`${cliVersion}\`。`,
    "- 提供 Windows x64 便携版和安装版。",
    "- 支持应用内自动更新，并按完整包与多版本残差链选择更节省流量的更新路径。",
    "",
    "## 下载",
    "",
    `- 便携版：\`${portableName}\``,
    `- 安装版：\`${installerName}\``,
    "",
    "安装程序封装在 ZIP 中，以避免浏览器直接下载 EXE 时的拦截。",
    "",
    `<!-- codex-rebuild-run-id:${sourceRunId} -->`,
    "",
  );
  return lines.join("\n");
}

async function fetchOfficialFeed(url = OFFICIAL_CHANGELOG_FEED) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Official changelog request failed (${response.status})`);
  return response.json();
}

function readPreviousUpdatedAt(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return "";
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return typeof parsed.updatedAt === "string" ? parsed.updatedAt : "";
}

async function main() {
  const args = process.argv.slice(2);
  const writePath = path.resolve(requiredValue(args, "--write"));
  const options = {
    appVersion: requiredValue(args, "--app-version"),
    msixVersion: requiredValue(args, "--msix-version"),
    cliVersion: requiredValue(args, "--cli-version"),
    releaseVersion: requiredValue(args, "--release-version"),
    portableName: requiredValue(args, "--portable-name"),
    installerName: requiredValue(args, "--installer-name"),
    sourceRunId: requiredValue(args, "--source-run-id"),
  };
  if (!/^\d+$/.test(options.sourceRunId)) throw new Error("--source-run-id must contain digits only");

  let officialUpdates = { kind: "none", items: [] };
  try {
    const feed = await fetchOfficialFeed(valueAfter(args, "--official-feed") || OFFICIAL_CHANGELOG_FEED);
    officialUpdates = selectOfficialUpdates(feed, {
      appVersion: options.appVersion,
      previousUpdatedAt: readPreviousUpdatedAt(valueAfter(args, "--previous")),
    });
  } catch (error) {
    console.warn(`Unable to include official Codex updates: ${error.message}`);
  }

  fs.mkdirSync(path.dirname(writePath), { recursive: true });
  fs.writeFileSync(writePath, renderReleaseNotes({ ...options, officialUpdates }), "utf8");
  console.log(`Wrote Windows release notes to ${writePath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  OFFICIAL_CHANGELOG_URL,
  declaredVersionFamilies,
  renderReleaseNotes,
  selectOfficialUpdates,
  versionFamily,
};
