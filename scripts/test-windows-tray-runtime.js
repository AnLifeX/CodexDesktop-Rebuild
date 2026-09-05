#!/usr/bin/env node
// Local Windows integration check using the installed App's Electron runtime.
// Uses a fresh test GUID and isolated user data; never launches the real App.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const asar = require("@electron/asar");
const { patchWindowsTraySource } = require("./patch-windows-tray");

async function main() {
  if (process.platform !== "win32") throw new Error("Run this check on Windows");
  const installed = path.resolve(process.argv[2] || "");
  const sourceAsar = path.join(installed, "resources", "app.asar");
  assert.ok(fs.existsSync(sourceAsar), "Pass the installed app-version directory");
  const output = path.resolve(__dirname, "../out/diagnostics");
  fs.mkdirSync(output, { recursive: true });
  const root = fs.mkdtempSync(path.join(output, "tray-runtime-"));
  const probe = path.join(root, "probe");
  fs.mkdirSync(probe);
  fs.writeFileSync(path.join(probe, "package.json"), JSON.stringify({ name: "codex-tray-probe", version: "1.0.0", main: "probe.cjs" }));
  const originalCall = "new electron.Tray(icons.defaultIcon,process.platform===`win32`&&electron.app.isPackaged?getGuid(flavor):void 0)";
  const patchedCall = patchWindowsTraySource(originalCall).code;
  fs.writeFileSync(path.join(probe, "probe.cjs"), `
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { app } = electron;
const report = process.env.CODEX_TRAY_PROBE_REPORT;
app.setPath('userData', process.env.CODEX_TRAY_PROBE_DATA);
app.setName('Codex tray local test');
let tray;
const finish = result => {
  if (tray && !tray.isDestroyed()) tray.destroy();
  fs.writeFileSync(report, JSON.stringify({ ...result, execPath: process.execPath, electron: process.versions.electron, destroyed: tray ? tray.isDestroyed() : null }));
  app.exit(0);
};
app.whenReady().then(async () => {
  try {
    const icons = { defaultIcon: electron.nativeImage.createFromPath(path.join(process.resourcesPath, 'tray.ico')) };
    if (icons.defaultIcon.isEmpty()) throw new Error('Test icon is empty');
    const flavor = 'prod', getGuid = () => process.env.CODEX_TRAY_PROBE_GUID;
    tray = process.env.CODEX_TRAY_PROBE_MODE === 'fixed' ? ${originalCall} : ${patchedCall};
    tray.setToolTip('Codex tray local test');
    tray.setContextMenu(electron.Menu.buildFromTemplate([{ label: 'Quit test', click: () => finish({ userQuit: true }) }]));
    if (typeof tray.whenReady === 'function') await Promise.race([tray.whenReady(), new Promise((_, reject) => setTimeout(() => reject(new Error('Tray readiness timed out')), 5000))]);
    let bounds = tray.getBounds();
    const deadline = Date.now() + 10000;
    while ((!bounds.width || !bounds.height) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
      bounds = tray.getBounds();
    }
    finish({ ready: typeof tray.isReady === 'function' ? tray.isReady() : null, bounds, guid: typeof tray.getGUID === 'function' ? tray.getGUID() : null });
  } catch (error) { finish({ error: error.message }); }
}).catch(error => finish({ error: error.message }));
`);
  const probeAsar = path.join(root, "probe.asar");
  await asar.createPackage(probe, probeAsar);
  const headerHash = file => {
    const buffer = fs.readFileSync(file);
    return crypto.createHash("sha256").update(buffer.subarray(16, 16 + buffer.readUInt32LE(12))).digest("hex");
  };
  const exe = fs.readFileSync(path.join(installed, "ChatGPT.exe"));
  const oldHash = headerHash(sourceAsar);
  const hashOffset = exe.indexOf(oldHash);
  assert.ok(hashOffset >= 0, "Installed EXE ASAR integrity anchor is missing");
  Buffer.from(headerHash(probeAsar)).copy(exe, hashOffset);
  const paths = [];
  for (const version of ["app-1", "app-2"]) {
    const dir = path.join(root, version);
    fs.mkdirSync(path.join(dir, "resources"), { recursive: true });
    for (const entry of fs.readdirSync(installed, { withFileTypes: true })) {
      if (!entry.isFile() || /\.exe$/i.test(entry.name) || /\.log$/i.test(entry.name)) continue;
      const from = path.join(installed, entry.name), to = path.join(dir, entry.name);
      try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); }
    }
    fs.cpSync(path.join(installed, "locales"), path.join(dir, "locales"), { recursive: true });
    fs.writeFileSync(path.join(dir, "ChatGPT.exe"), exe);
    fs.copyFileSync(probeAsar, path.join(dir, "resources", "app.asar"));
    fs.copyFileSync(path.join(installed, "resources", "chatgpt-tray-dark.ico"), path.join(dir, "resources", "tray.ico"));
    fs.writeFileSync(path.join(dir, "resources", "owl-app.ini"), "[Owl]\nUserDataDirectoryName=CodexTrayProbe\nAppVersion=1.0.0\n");
    paths.push(dir);
  }
  const guid = crypto.randomUUID();
  const results = [];
  for (const [label, index, mode] of [["fixed-first-path", 0, "fixed"], ["fixed-changed-path", 1, "fixed"], ["fresh-guid-second-path", 1, "fixed"], ["patched-changed-path", 1, "patched"], ["patched-restart", 1, "patched"], ["patched-other-path", 0, "patched"]]) {
    const report = path.join(root, label + ".json");
    const data = path.join(root, "user-data", label);
    const env = { ...process.env, CODEX_TRAY_PROBE_REPORT: report, CODEX_TRAY_PROBE_DATA: data, CODEX_TRAY_PROBE_GUID: label.startsWith("fresh-") ? crypto.randomUUID() : guid, CODEX_TRAY_PROBE_MODE: mode };
    delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const child = spawn(path.join(paths[index], "ChatGPT.exe"), ["--user-data-dir=" + data, "--disable-background-networking", "--no-first-run"], { env, windowsHide: true, stdio: "ignore" });
      const timeout = setTimeout(() => { child.kill(); reject(new Error(label + " process timed out")); }, 20000);
      child.on("error", error => { clearTimeout(timeout); reject(error); });
      child.on("exit", code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(label + " exited " + code)); });
    });
    const result = { label, ...JSON.parse(fs.readFileSync(report, "utf8")) };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  fs.writeFileSync(path.join(root, "results.json"), JSON.stringify(results, null, 2));
  const visible = result => !result.error && result.bounds.width > 0 && result.bounds.height > 0 && result.destroyed;
  assert.ok(visible(results[0]), "Baseline tray registration failed");
  assert.ok(!visible(results[1]), "Fixed-GUID path-change failure did not reproduce");
  for (const result of results.slice(2)) assert.ok(visible(result), result.label + " did not register a tray icon");
  console.log("Fixed-GUID path-change failure reproduced: " + !visible(results[1]));
  console.log("Results: " + root);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
