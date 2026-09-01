#!/usr/bin/env node
/**
 * check-update.js — Codex 版本检测工具
 *
 * 检查 macOS (Sparkle appcast) 和 Windows (MS Store) 的最新版本
 *
 * 用法:
 *   node scripts/check-update.js              # 检查当前版本
 *   node scripts/check-update.js --json       # JSON 输出
 *   node scripts/check-update.js --windows-only # 仅检查 Windows（Windows CI 使用）
 */

const https = require("https");
const tls = require("tls");
const { XMLParser } = require("fast-xml-parser");
const fs = require("fs");
const path = require("path");
const { selectWindowsMsixPackage } = require("./windows-package-utils");
const {
  readWindowsInternalAppVersionFromRemoteMsix,
} = require("./windows-msix-internal-version");

// ─── 证书注入（复用 fetch-msstore 的 CA 补丁）─────────────────────
const certsDir = path.join(__dirname, "certs");
const extraCAs = [...tls.rootCertificates];
for (const f of ["ms-root-ca.pem", "ms-update-ca.pem"]) {
  const p = path.join(certsDir, f);
  if (fs.existsSync(p)) extraCAs.push(fs.readFileSync(p, "utf-8"));
}
https.globalAgent.options.ca = extraCAs;

// ─── 常量 ────────────────────────────────────────────────────────
const APPCAST_ARM64 = "https://persistent.oaistatic.com/codex-app-prod/appcast.xml";
const APPCAST_X64 = "https://persistent.oaistatic.com/codex-app-prod/appcast-x64.xml";
const MS_STORE_PRODUCT_ID = "9plm9xgg6vks";

// ─── HTTP 辅助 ───────────────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return httpsGet(res.headers.location).then(resolve, reject);
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf-8"),
          })
        );
      })
      .on("error", reject);
  });
}

// ─── macOS: Sparkle appcast ──────────────────────────────────────
async function checkMacArm64Version() { return checkAppcast(APPCAST_ARM64, "macOS-arm64"); }
async function checkMacX64Version() { return checkAppcast(APPCAST_X64, "macOS-x64"); }

async function checkAppcast(url, platformLabel) {
  const res = await httpsGet(url);
  if (res.status !== 200) {
    throw new Error(`appcast.xml 请求失败: HTTP ${res.status}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
  });
  const parsed = parser.parse(res.body);

  // 取第一个 item（最新版本）
  const items = parsed.rss?.channel?.item;
  const latest = Array.isArray(items) ? items[0] : items;

  if (!latest) throw new Error(`${platformLabel}: no version in appcast`);

  let enclosure = latest.enclosure;
  if (Array.isArray(enclosure)) enclosure = enclosure[0];

  return {
    platform: platformLabel,
    version: latest.shortVersionString || latest.title,
    build: String(latest.version || ""),
    pubDate: latest.pubDate || "",
    downloadUrl: enclosure?.["@_url"] || "",
    size: Number(enclosure?.["@_length"] || 0),
    minimumSystemVersion: latest.minimumSystemVersion || "",
  };
}

// ─── Windows: MS Store ───────────────────────────────────────────
async function checkWindowsVersion() {
  // 动态加载 fetch-msstore 的模块 API
  const msstore = require("./fetch-msstore");

  const cookie = await msstore.getCookie();
  const appInfo = await msstore.getAppInfo(MS_STORE_PRODUCT_ID, "US");

  if (!appInfo.categoryId) {
    throw new Error("无法获取 MS Store CategoryID");
  }

  const packages = await msstore.getFileList(
    cookie,
    appInfo.categoryId,
    "Retail"
  );

  if (packages.length === 0) {
    throw new Error("MS Store 未返回任何包");
  }

  // 从包名提取版本: OpenAI.Codex_26.325.2171.0_x64__xxx.msix
  const pkg = selectWindowsMsixPackage(packages, "x64");
  const versionMatch = pkg.name.match(/_(\d+\.\d+\.\d+(?:\.\d+)?)_/);
  const msixVersion = versionMatch ? versionMatch[1] : "unknown";

  // 获取下载链接
  const url = await msstore.getDownloadUrl(
    pkg.updateID,
    pkg.revisionNumber,
    "Retail",
    pkg.digest
  );
  const size = Number(pkg.size || 0);
  const internalAppVersion = await readWindowsInternalAppVersionFromRemoteMsix({
    url,
    size,
  });

  return {
    platform: "Windows",
    version: internalAppVersion,
    internalAppVersion,
    msixVersion,
    build: "",
    pubDate: "",
    downloadUrl: url,
    size,
    packageName: pkg.name,
  };
}

function formatSize(bytes) {
  if (!bytes) return "Unknown";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

// ─── 主流程 ──────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const windowsOnly = args.includes("--windows-only");
  const quiet = jsonOutput || args.includes("--quiet") || args.includes("-q");

  const results = [];

  const checks = await Promise.allSettled(windowsOnly
    ? [checkWindowsVersion()]
    : [checkMacArm64Version(), checkMacX64Version(), checkWindowsVersion()]);
  const failures = [];

  for (const r of checks) {
    if (r.status === "fulfilled") {
      results.push(r.value);
    } else {
      failures.push(r.reason);
      if (!quiet) console.error(`  [!] ${r.reason.message}`);
    }
  }

  if (windowsOnly && failures.length > 0) {
    throw new Error(`Windows version check failed: ${failures[0].message}`);
  }

  // JSON 输出模式
  if (jsonOutput) {
    const output = {
      timestamp: new Date().toISOString(),
      platforms: Object.fromEntries(results.map((r) => [r.platform, r])),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    for (const info of results) {
      console.log(`📌 当前版本 [${info.platform}]`);
      console.log(`  版本: ${info.version}${info.build ? ` (build ${info.build})` : ""}`);
      if (info.msixVersion) console.log(`  MSIX: ${info.msixVersion}`);
      if (info.pubDate) console.log(`  发布: ${info.pubDate}`);
      console.log(`  大小: ${formatSize(info.size)}`);
      if (info.packageName) console.log(`  包名: ${info.packageName}`);
      if (info.downloadUrl) {
        console.log(`  链接: ${info.downloadUrl.slice(0, 100)}${info.downloadUrl.length > 100 ? "..." : ""}`);
      }
      console.log();
    }
  }

  return { results };
}

module.exports = { checkMacArm64Version, checkMacX64Version, checkWindowsVersion };

if (require.main === module) {
  main().catch((e) => {
    console.error(`\n❌ 错误: ${e.message}`);
    process.exit(2);
  });
}
