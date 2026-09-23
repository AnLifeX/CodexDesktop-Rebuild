#!/usr/bin/env node
/**
 * fetch-msstore.js — Microsoft Store MSIX/APPX 包下载器
 *
 * 从 Microsoft Store 获取应用包的直链下载地址
 * 基于 Windows Update SOAP API（fe3.delivery.mp.microsoft.com）
 *
 * 用法:
 *   node scripts/fetch-msstore.js <productId> [--ring <ring>] [--market <market>] [--download] [--filter <keyword>]
 *
 * 示例:
 *   node scripts/fetch-msstore.js 9plm9xgg6vks
 *   node scripts/fetch-msstore.js 9plm9xgg6vks --ring Retail --download --filter x64
 */

const https = require("https");
const tls = require("tls");
const { XMLParser } = require("fast-xml-parser");
const fs = require("fs");
const path = require("path");

// ─── 补充微软 WU 服务的证书链 ────────────────────────────────────
// 微软 fe3.delivery.mp.microsoft.com 服务端不发送中间 CA 证书，
// 导致 Node.js（不像浏览器）无法构建完整的信任链。
// 这里将 Microsoft Root CA 2011 + Update Secure Server CA 2.1
// 注入到全局 HTTPS agent 的 ca 选项中。
const certsDir = path.join(__dirname, "certs");
const extraCAs = [...tls.rootCertificates];
for (const f of ["ms-root-ca.pem", "ms-update-ca.pem"]) {
  const p = path.join(certsDir, f);
  if (fs.existsSync(p)) extraCAs.push(fs.readFileSync(p, "utf-8"));
}
// 覆盖默认 HTTPS agent，注入额外 CA
https.globalAgent.options.ca = extraCAs;

// ─── SOAP XML 模板 ───────────────────────────────────────────────

const COOKIE_SOAP = `<Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.w3.org/2003/05/soap-envelope">
  <Header>
    <Action d3p1:mustUnderstand="1" xmlns:d3p1="http://www.w3.org/2003/05/soap-envelope" xmlns="http://www.w3.org/2005/08/addressing">http://www.microsoft.com/SoftwareDistribution/Server/ClientWebService/GetCookie</Action>
    <MessageID xmlns="http://www.w3.org/2005/08/addressing">urn:uuid:b9b43757-2247-4d7b-ae8f-a71ba8a22386</MessageID>
    <To d3p1:mustUnderstand="1" xmlns:d3p1="http://www.w3.org/2003/05/soap-envelope" xmlns="http://www.w3.org/2005/08/addressing">https://fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx</To>
    <Security d3p1:mustUnderstand="1" xmlns:d3p1="http://www.w3.org/2003/05/soap-envelope" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <Timestamp xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
        <Created>2017-12-02T00:16:15.210Z</Created>
        <Expires>2017-12-29T06:25:43.943Z</Expires>
      </Timestamp>
      <WindowsUpdateTicketsToken d4p1:id="ClientMSA" xmlns:d4p1="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" xmlns="http://schemas.microsoft.com/msus/2014/10/WindowsUpdateAuthorization">
        <TicketType Name="MSA" Version="1.0" Policy="MBI_SSL"><User /></TicketType>
      </WindowsUpdateTicketsToken>
    </Security>
  </Header>
  <Body>
    <GetCookie xmlns="http://www.microsoft.com/SoftwareDistribution/Server/ClientWebService">
      <oldCookie></oldCookie>
      <lastChange>2015-10-21T17:01:07.1472913Z</lastChange>
      <currentTime>2017-12-02T00:16:15.217Z</currentTime>
      <protocolVersion>1.40</protocolVersion>
    </GetCookie>
  </Body>
</Envelope>`;

// Device token — 硬编码的匿名设备票据（和原项目一致）
const DEVICE_TOKEN =
  "dAA9AEUAdwBBAHcAQQBzAE4AMwBCAEEAQQBVADEAYgB5AHMAZQBtAGIAZQBEAFYAQwArADMAZgBtADcAbwBXAHkASAA3AGIAbgBnAEcAWQBtAEEAQQBMAGoAbQBqAFYAVQB2AFEAYwA0AEsAVwBFAC8AYwBDAEwANQBYAGUANABnAHYAWABkAGkAegBHAGwAZABjADEAZAAvAFcAeQAvAHgASgBQAG4AVwBRAGUAYwBtAHYAbwBjAGkAZwA5AGoAZABwAE4AawBIAG0AYQBzAHAAVABKAEwARAArAFAAYwBBAFgAbQAvAFQAcAA3AEgAagBzAEYANAA0AEgAdABsAC8AMQBtAHUAcgAwAFMAdQBtAG8AMABZAGEAdgBqAFIANwArADQAcABoAC8AcwA4ADEANgBFAFkANQBNAFIAbQBnAFIAQwA2ADMAQwBSAEoAQQBVAHYAZgBzADQAaQB2AHgAYwB5AEwAbAA2AHoAOABlAHgAMABrAFgAOQBPAHcAYQB0ADEAdQBwAFMAOAAxAEgANgA4AEEASABzAEoAegBnAFQAQQBMAG8AbgBBADIAWQBBAEEAQQBpAGcANQBJADMAUQAvAFYASABLAHcANABBAEIAcQA5AFMAcQBhADEAQgA4AGsAVQAxAGEAbwBLAEEAdQA0AHYAbABWAG4AdwBWADMAUQB6AHMATgBtAEQAaQBqAGgANQBkAEcAcgBpADgAQQBlAEUARQBWAEcAbQBXAGgASQBCAE0AUAAyAEQAVwA0ADMAZABWAGkARABUAHoAVQB0AHQARQBMAEgAaABSAGYAcgBhAGIAWgBsAHQAQQBUAEUATABmAHMARQBGAFUAYQBRAFMASgB4ADUAeQBRADgAagBaAEUAZQAyAHgANABCADMAMQB2AEIAMgBqAC8AUgBLAGEAWQAvAHEAeQB0AHoANwBUAHYAdAB3AHQAagBzADYAUQBYAEIAZQA4AHMAZwBJAG8AOQBiADUAQQBCADcAOAAxAHMANgAvAGQAUwBFAHgATgBEAEQAYQBRAHoAQQBYAFAAWABCAFkAdQBYAFEARQBzAE8AegA4AHQAcgBpAGUATQBiAEIAZQBUAFkAOQBiAG8AQgBOAE8AaQBVADcATgBSAEYAOQAzAG8AVgArAFYAQQBiAGgAcAAwAHAAUgBQAFMAZQBmAEcARwBPAHEAdwBTAGcANwA3AHMAaAA5AEoASABNAHAARABNAFMAbgBrAHEAcgAyAGYARgBpAEMAUABrAHcAVgBvAHgANgBuAG4AeABGAEQAbwBXAC8AYQAxAHQAYQBaAHcAegB5AGwATABMADEAMgB3AHUAYgBtADUAdQBtAHAAcQB5AFcAYwBLAFIAagB5AGgAMgBKAFQARgBKAFcANQBnAFgARQBJADUAcAA4ADAARwB1ADIAbgB4AEwAUgBOAHcAaQB3AHIANwBXAE0AUgBBAFYASwBGAFcATQBlAFIAegBsADkAVQBxAGcALwBwAFgALwB2AGUATAB3AFMAawAyAFMAUwBIAGYAYQBLADYAagBhAG8AWQB1AG4AUgBHAHIAOABtAGIARQBvAEgAbABGADYASgBDAGEAYQBUAEIAWABCAGMAdgB1AGUAQwBKAG8AOQA4AGgAUgBBAHIARwB3ADQAKwBQAEgAZQBUAGIATgBTAEUAWABYAHoAdgBaADYAdQBXADUARQBBAGYAZABaAG0AUwA4ADgAVgBKAGMAWgBhAEYASwA3AHgAeABnADAAdwBvAG4ANwBoADAAeABDADYAWgBCADAAYwBZAGoATAByAC8ARwBlAE8AegA5AEcANABRAFUASAA5AEUAawB5ADAAZAB5AEYALwByAGUAVQAxAEkAeQBpAGEAcABwAGgATwBQADgAUwAyAHQANABCAHIAUABaAFgAVAB2AEMAMABQADcAegBPACsAZgBHAGsAeABWAG0AKwBVAGYAWgBiAFEANQA1AHMAdwBFAD0AJgBwAD0A";

function makeSyncUpdatesSoap(cookie, categoryId, ring) {
  return `<s:Envelope xmlns:a="http://www.w3.org/2005/08/addressing" xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Header>
    <a:Action s:mustUnderstand="1">http://www.microsoft.com/SoftwareDistribution/Server/ClientWebService/SyncUpdates</a:Action>
    <a:MessageID>urn:uuid:175df68c-4b91-41ee-b70b-f2208c65438e</a:MessageID>
    <a:To s:mustUnderstand="1">https://fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx</a:To>
    <o:Security s:mustUnderstand="1" xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <Timestamp xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
        <Created>2017-08-05T02:03:05.038Z</Created>
        <Expires>2017-08-05T02:08:05.038Z</Expires>
      </Timestamp>
      <wuws:WindowsUpdateTicketsToken wsu:id="ClientMSA" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" xmlns:wuws="http://schemas.microsoft.com/msus/2014/10/WindowsUpdateAuthorization">
        <TicketType Name="MSA" Version="1.0" Policy="MBI_SSL"><Device>${DEVICE_TOKEN}</Device></TicketType>
      </wuws:WindowsUpdateTicketsToken>
    </o:Security>
  </s:Header>
  <s:Body>
    <SyncUpdates xmlns="http://www.microsoft.com/SoftwareDistribution/Server/ClientWebService">
      <cookie>
        <Expiration>2045-03-11T02:02:48Z</Expiration>
        <EncryptedData>${cookie}</EncryptedData>
      </cookie>
      <parameters>
        <ExpressQuery>false</ExpressQuery>
        <InstalledNonLeafUpdateIDs>
          <int>1</int><int>2</int><int>3</int><int>11</int><int>19</int>
          <int>544</int><int>549</int><int>2359974</int><int>2359977</int>
          <int>5169044</int><int>8788830</int><int>23110993</int><int>23110994</int>
          <int>54341900</int><int>54343656</int><int>59830006</int><int>59830007</int>
          <int>59830008</int><int>60484010</int><int>62450018</int><int>62450019</int>
          <int>62450020</int><int>66027979</int><int>66053150</int><int>97657898</int>
          <int>98822896</int><int>98959022</int><int>98959023</int><int>98959024</int>
          <int>98959025</int><int>98959026</int><int>104433538</int><int>104900364</int>
          <int>105489019</int><int>117765322</int><int>129905029</int><int>130040031</int>
          <int>132387090</int><int>132393049</int><int>133399034</int><int>138537048</int>
          <int>140377312</int><int>143747671</int><int>158941041</int><int>158941042</int>
          <int>158941043</int><int>158941044</int><int>159123858</int><int>159130928</int>
          <int>164836897</int><int>164847386</int><int>164848327</int><int>164852241</int>
          <int>164852246</int><int>164852252</int><int>164852253</int>
        </InstalledNonLeafUpdateIDs>
        <OtherCachedUpdateIDs></OtherCachedUpdateIDs>
        <SkipSoftwareSync>false</SkipSoftwareSync>
        <NeedTwoGroupOutOfScopeUpdates>true</NeedTwoGroupOutOfScopeUpdates>
        <FilterAppCategoryIds>
          <CategoryIdentifier><Id>${categoryId}</Id></CategoryIdentifier>
        </FilterAppCategoryIds>
        <TreatAppCategoryIdsAsInstalled>true</TreatAppCategoryIdsAsInstalled>
        <AlsoPerformRegularSync>false</AlsoPerformRegularSync>
        <ComputerSpec />
        <ExtendedUpdateInfoParameters>
          <XmlUpdateFragmentTypes>
            <XmlUpdateFragmentType>Extended</XmlUpdateFragmentType>
          </XmlUpdateFragmentTypes>
        </ExtendedUpdateInfoParameters>
        <ProductsParameters>
          <SyncCurrentVersionOnly>false</SyncCurrentVersionOnly>
          <DeviceAttributes>FlightRing=${ring};DeviceFamily=Windows.Desktop;</DeviceAttributes>
          <CallerAttributes>Interactive=1;IsSeeker=0;</CallerAttributes>
          <Products />
        </ProductsParameters>
      </parameters>
    </SyncUpdates>
  </s:Body>
</s:Envelope>`;
}

function makeGetUrlSoap(updateID, revisionNumber, ring) {
  return `<s:Envelope xmlns:a="http://www.w3.org/2005/08/addressing" xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Header>
    <a:Action s:mustUnderstand="1">http://www.microsoft.com/SoftwareDistribution/Server/ClientWebService/GetExtendedUpdateInfo2</a:Action>
    <a:MessageID>urn:uuid:2cc99c2e-3b3e-4fb1-9e31-0cd30e6f43a0</a:MessageID>
    <a:To s:mustUnderstand="1">https://fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx/secured</a:To>
    <o:Security s:mustUnderstand="1" xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <Timestamp xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
        <Created>2017-08-01T00:29:01.868Z</Created>
        <Expires>2017-08-01T00:34:01.868Z</Expires>
      </Timestamp>
      <wuws:WindowsUpdateTicketsToken wsu:id="ClientMSA" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" xmlns:wuws="http://schemas.microsoft.com/msus/2014/10/WindowsUpdateAuthorization">
        <TicketType Name="MSA" Version="1.0" Policy="MBI_SSL"><Device>${DEVICE_TOKEN}</Device></TicketType>
      </wuws:WindowsUpdateTicketsToken>
    </o:Security>
  </s:Header>
  <s:Body>
    <GetExtendedUpdateInfo2 xmlns="http://www.microsoft.com/SoftwareDistribution/Server/ClientWebService">
      <updateIDs>
        <UpdateIdentity>
          <UpdateID>${updateID}</UpdateID>
          <RevisionNumber>${revisionNumber}</RevisionNumber>
        </UpdateIdentity>
      </updateIDs>
      <infoTypes>
        <XmlUpdateFragmentType>FileUrl</XmlUpdateFragmentType>
        <XmlUpdateFragmentType>FileDecryption</XmlUpdateFragmentType>
      </infoTypes>
      <deviceAttributes>FlightRing=${ring};DeviceFamily=Windows.Desktop;</deviceAttributes>
    </GetExtendedUpdateInfo2>
  </s:Body>
</s:Envelope>`;
}

// ─── HTTP 辅助 ───────────────────────────────────────────────────

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOpts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || "GET",
      headers: options.headers || {},
    };

    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error("Request timeout"));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

function soapPost(url, body) {
  return httpsRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/soap+xml; charset=utf-8",
      "Content-Length": Buffer.byteLength(body, "utf-8"),
    },
    body,
  });
}

// ─── XML 解析（使用 fast-xml-parser） ────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (name) =>
    ["File", "SecuredFragment", "FileLocation", "UpdateInfo", "int"].includes(
      name
    ),
});

function parseXml(xml) {
  return xmlParser.parse(xml);
}

// ─── 日志（仅 CLI 直接运行时输出）─────────────────────────────────
const isCLI = require.main === module;
const log = (...args) => isCLI && console.log(...args);

// ─── 核心流程 ────────────────────────────────────────────────────

async function getCookie() {
  log("  [1/4] 获取 cookie...");
  const res = await soapPost(
    "https://fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx",
    COOKIE_SOAP
  );

  if (res.status !== 200) {
    throw new Error(`GetCookie 失败: HTTP ${res.status}`);
  }

  const parsed = parseXml(res.body);

  // 深度搜索 EncryptedData
  const cookie = deepFind(parsed, "EncryptedData");
  if (!cookie) {
    throw new Error("无法从响应中提取 EncryptedData");
  }

  log(`    cookie 长度: ${cookie.length}`);
  return cookie;
}

async function getAppInfo(productId, market = "US", locale = "en-US") {
  log(`  [2/4] 查询应用信息: ${productId}...`);
  const url = `https://storeedgefd.dsx.mp.microsoft.com/v9.0/products/${productId}?market=${market}&locale=${locale}&deviceFamily=Windows.Desktop`;
  const res = await httpsRequest(url);

  if (res.status !== 200) {
    throw new Error(`GetAppInfo 失败: HTTP ${res.status}`);
  }

  const data = JSON.parse(res.body);
  const payload = data.Payload;

  const name = payload.Title;
  const publisher = payload.PublisherName;
  let categoryId = "";

  if (payload.Skus && payload.Skus.length > 0) {
    const sku = payload.Skus[0];
    if (sku.FulfillmentData) {
      const fd = JSON.parse(sku.FulfillmentData);
      categoryId = fd.WuCategoryId;
    }
  }

  log(`    应用: ${name}`);
  log(`    发布者: ${publisher}`);
  log(`    CategoryID: ${categoryId}`);

  return { name, publisher, categoryId, productId };
}

async function getFileList(cookie, categoryId, ring) {
  log(`  [3/4] 获取文件列表 (ring=${ring})...`);
  const soap = makeSyncUpdatesSoap(cookie, categoryId, ring);
  const res = await soapPost(
    "https://fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx",
    soap
  );

  if (res.status !== 200) {
    throw new Error(`SyncUpdates 失败: HTTP ${res.status}`);
  }

  // 响应中的 XML 片段被 HTML-encoded，需要反转义
  let body = res.body.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const parsed = parseXml(body);

  // 提取 File 节点 → {name: {extension, size, digest}}
  const filesInfo = new Map();
  const files = deepFindAll(parsed, "File");
  for (const f of files) {
    const name = f["@_InstallerSpecificIdentifier"];
    if (!name) continue;
    const fileName = f["@_FileName"] || "";
    const ext = fileName.includes(".")
      ? fileName.slice(fileName.lastIndexOf("."))
      : "";
    filesInfo.set(name, {
      extension: ext,
      size: f["@_Size"] || "0",
      digest: f["@_Digest"] || "",
    });
  }

  // 提取 UpdateIdentity + PackageMoniker
  const updates = [];
  const updateInfos = deepFindAll(parsed, "UpdateInfo");

  for (const ui of updateInfos) {
    const packageMoniker = deepFindAttr(ui, "AppxMetadata", "@_PackageMoniker");
    if (!packageMoniker) continue;

    const updateIdentity =
      deepFind(ui, "UpdateIdentity") || findNested(ui, "UpdateIdentity");
    if (!updateIdentity) continue;

    const updateID = updateIdentity["@_UpdateID"];
    const revisionNumber = updateIdentity["@_RevisionNumber"];

    if (updateID && filesInfo.has(packageMoniker)) {
      const info = filesInfo.get(packageMoniker);
      updates.push({
        name: packageMoniker + info.extension,
        size: info.size,
        digest: info.digest,
        updateID,
        revisionNumber,
      });
    }
  }

  log(`    找到 ${updates.length} 个包`);
  return updates;
}

async function getDownloadUrl(updateID, revisionNumber, ring, digest) {
  const soap = makeGetUrlSoap(updateID, revisionNumber, ring);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await soapPost(
      "https://fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx/secured",
      soap
    );
    if (res.status === 200) {
      const locations = deepFindAll(parseXml(res.body), "FileLocation");
      for (const loc of locations) {
        const fileDigest = deepFind(loc, "FileDigest");
        const url = deepFind(loc, "Url");
        if (fileDigest === digest && typeof url === "string" && url.startsWith("http")) return url;
      }
      // 如果 digest 匹配不到，返回第一个 URL
      for (const loc of locations) {
        const url = deepFind(loc, "Url");
        if (url && typeof url === "string" && url.startsWith("http")) return url;
      }
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error("Microsoft Store did not return a download URL after 3 attempts");
}

// ─── 深度搜索辅助 ────────────────────────────────────────────────

function deepFind(obj, key) {
  if (obj == null || typeof obj !== "object") return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const r = deepFind(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

function deepFindAll(obj, key, results = []) {
  if (obj == null || typeof obj !== "object") return results;
  if (key in obj) {
    const val = obj[key];
    if (Array.isArray(val)) results.push(...val);
    else results.push(val);
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") deepFindAll(v, key, results);
  }
  return results;
}

function deepFindAttr(obj, elemName, attrName) {
  if (obj == null || typeof obj !== "object") return undefined;
  if (elemName in obj) {
    const elem = obj[elemName];
    if (elem && typeof elem === "object" && attrName in elem)
      return elem[attrName];
  }
  for (const v of Object.values(obj)) {
    const r = deepFindAttr(v, elemName, attrName);
    if (r !== undefined) return r;
  }
  return undefined;
}

function findNested(obj, key) {
  if (obj == null || typeof obj !== "object") return undefined;
  for (const [k, v] of Object.entries(obj)) {
    if (k === key) return v;
    if (v && typeof v === "object") {
      const r = findNested(v, key);
      if (r) return r;
    }
  }
  return undefined;
}

function formatSize(bytes) {
  const num = Number(bytes);
  if (isNaN(num) || num === 0) return "Unknown";
  if (num < 1024) return num + " B";
  if (num < 1024 * 1024) return (num / 1024).toFixed(1) + " KB";
  if (num < 1024 * 1024 * 1024) return (num / (1024 * 1024)).toFixed(1) + " MB";
  return (num / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

// ─── 下载 ────────────────────────────────────────────────────────

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const doRequest = (reqUrl) => {
      https
        .get(reqUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doRequest(res.headers.location);
            return;
          }
          const total = parseInt(res.headers["content-length"] || "0", 10);
          let downloaded = 0;

          res.on("data", (chunk) => {
            downloaded += chunk.length;
            file.write(chunk);
            if (total > 0) {
              const pct = ((downloaded / total) * 100).toFixed(1);
              process.stdout.write(`\r    下载中: ${pct}% (${formatSize(downloaded)} / ${formatSize(total)})`);
            }
          });

          res.on("end", () => {
            file.end();
            process.stdout.write("\n");
            resolve(destPath);
          });

          res.on("error", reject);
        })
        .on("error", reject);
    };
    doRequest(url);
  });
}

// ─── 主流程 ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
用法: node fetch-msstore.js <productId> [选项]

选项:
  --ring <ring>       通道 (Retail/RP/WIS/WIF)，默认 Retail
  --market <code>     市场代码，默认 US
  --download          下载找到的包
  --filter <keyword>  按关键字过滤包名 (如 x64, arm64)
  --out <dir>         下载输出目录，默认 ./downloads

示例:
  node fetch-msstore.js 9plm9xgg6vks
  node fetch-msstore.js 9plm9xgg6vks --download --filter x64
`);
    process.exit(0);
  }

  // 解析参数
  let productId = args[0];
  let ring = "Retail";
  let market = "US";
  let doDownload = false;
  let filter = "";
  let outDir = path.join(process.cwd(), "downloads");

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--ring":
        ring = args[++i];
        break;
      case "--market":
        market = args[++i];
        break;
      case "--download":
        doDownload = true;
        break;
      case "--filter":
        filter = args[++i].toLowerCase();
        break;
      case "--out":
        outDir = path.resolve(args[++i]);
        break;
    }
  }

  // 清理 productId（可能传入了完整 URL）
  if (productId.includes("/")) {
    productId = productId.split("/").pop();
  }
  if (productId.includes("?")) {
    productId = productId.split("?")[0];
  }

  console.log(`\n📦 Microsoft Store 包查询`);
  console.log(`   ProductID: ${productId}`);
  console.log(`   Ring: ${ring}\n`);

  // Step 1: Cookie
  const cookie = await getCookie();

  // Step 2: App Info
  const appInfo = await getAppInfo(productId, market);

  if (!appInfo.categoryId) {
    console.error("\n❌ 无法获取 CategoryID，该应用可能不是 MSIX/APPX 打包应用");
    process.exit(1);
  }

  // Step 3: File List
  const packages = await getFileList(cookie, appInfo.categoryId, ring);

  if (packages.length === 0) {
    console.error("\n❌ 未找到任何包");
    process.exit(1);
  }

  // Step 4: Get URLs
  console.log(`  [4/4] 获取下载链接...`);
  const results = [];

  for (const pkg of packages) {
    const url = await getDownloadUrl(
      pkg.updateID,
      pkg.revisionNumber,
      ring,
      pkg.digest
    );
    results.push({ ...pkg, url });
  }

  // 过滤
  let filtered = results;
  if (filter) {
    filtered = results.filter((r) => r.name.toLowerCase().includes(filter));
  }

  // 输出结果
  console.log(`\n${"─".repeat(80)}`);
  console.log(`📋 ${appInfo.name} — 共 ${filtered.length} 个包\n`);

  for (const pkg of filtered) {
    const size = formatSize(pkg.size);
    const hasUrl = pkg.url ? "✅" : "❌";
    console.log(`  ${hasUrl} ${pkg.name}`);
    console.log(`     大小: ${size}`);
    if (pkg.url) {
      console.log(`     链接: ${pkg.url.slice(0, 120)}...`);
    }
    console.log();
  }

  // 下载
  if (doDownload) {
    const toDownload = filtered.filter((r) => r.url);
    if (toDownload.length === 0) {
      console.log("没有可下载的包");
      return;
    }

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    console.log(`\n⬇️  开始下载到 ${outDir}\n`);
    for (const pkg of toDownload) {
      const dest = path.join(outDir, pkg.name);
      console.log(`  📥 ${pkg.name}`);
      await downloadFile(pkg.url, dest);
      console.log(`    ✅ 保存到 ${dest}`);
    }
  }

  // 导出 JSON 供其他脚本使用
  return filtered;
}

// 支持作为模块导入
module.exports = { getCookie, getAppInfo, getFileList, getDownloadUrl };

// CLI 直接运行
if (require.main === module) {
  main().catch((e) => {
    console.error(`\n❌ 错误: ${e.message}`);
    process.exit(1);
  });
}
