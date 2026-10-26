// Embedded into the main-process bootstrap; no Node helper is exposed to the renderer.
function windowsInstallLifecycle(app, BrowserWindow) {
  const fs = require("node:fs");
  const path = require("node:path");
  const cp = require("node:child_process");
  if (!app.isPackaged || !process.env.LOCALAPPDATA) return false;
  const appDir = path.dirname(process.execPath);
  const current = path.basename(appDir);
  if (!/^app-\d+\.\d+\.\d+(?:-r\d+|-rebuild\d+)?$/i.test(current)) return false;
  const root = path.dirname(appDir);
  const legacy = path.resolve(process.env.LOCALAPPDATA, "Codex");
  const target = path.resolve(process.env.LOCALAPPDATA, "Programs", "Codex");
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  if (!same(root, legacy) && !same(root, target)) return false;
  const helper = path.join(appDir, "CodexUpdater.exe");
  if (!fs.existsSync(path.join(root, "Update.exe")) || !fs.existsSync(helper)) return false;
  const event = process.argv.find(arg => /^--squirrel-(install|updated|uninstall|obsolete)$/.test(arg));
  if (event) {
    if (event === "--squirrel-install" || event === "--squirrel-updated") {
      const result = cp.spawnSync(helper, ["--maintenance-retain", root, current], { windowsHide: true, timeout: 8000 });
      if (result.error || result.status !== 0) console.warn("[CodexInstall] Could not record retained versions", result.error || result.status);
    } else if (event === "--squirrel-uninstall") {
      cp.spawnSync(helper, ["--maintenance-uninstall", root], { windowsHide: true, timeout: 8000 });
    }
    return false;
  }
  if (same(root, legacy) && process.env.CODEX_REBUILD_SKIP_MIGRATION !== "1") {
    let failed = false;
    try { failed = fs.readFileSync(path.join(root, ".codex-migration-failed"), "utf8").trim() === current; } catch {}
    if (fs.existsSync(path.join(root, ".codex-migrated")) && fs.existsSync(path.join(target, "Update.exe"))) {
        const child = cp.spawn(path.join(target, "Update.exe"), ["--processStart", "Codex.exe"], { detached: true, windowsHide: true, stdio: "ignore" });
        child.on("error", error => console.warn("[CodexInstall] Redirect failed", error));
        child.once("spawn", () => app.quit());
        child.unref();
        return false;
    }
    if (!failed) {
      // A partially copied or independent destination is never merged or overwritten.
      if (!fs.existsSync(target) && !fs.existsSync(target + ".migrating")) {
        const child = cp.spawn(helper, ["--maintenance-migrate", root, current, String(process.pid), ...process.argv.slice(1)], { detached: true, windowsHide: true, stdio: "ignore" });
        child.on("error", error => console.warn("[CodexInstall] Migration could not start", error));
        child.once("spawn", () => app.quit());
        child.unref();
        return false;
      }
    }
  }
  let confirmed = false;
  const observe = window => {
    if (!window?.webContents || window.isDestroyed()) return;
    let timer;
    const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
    window.webContents.on("render-process-gone", cancel);
    window.webContents.on("did-start-loading", cancel);
    window.webContents.on("did-fail-load", cancel);
    window.on("closed", cancel);
    window.webContents.on("did-finish-load", () => {
      cancel();
      const url = window.webContents.getURL().split(/[?#]/)[0];
      // Updater dialogs and DevTools must not confirm the application is healthy.
      const indexFile = require("node:url").pathToFileURL(path.join(app.getAppPath(), "webview", "index.html")).href;
      if (url !== "app://-/index.html" && url !== indexFile) return;
      timer = setTimeout(async () => {
        if (confirmed || window.isDestroyed() || window.webContents.isDestroyed()) return;
        try {
          if (!await window.webContents.executeJavaScript("document.readyState==='complete'&&!!document.body&&document.body.innerText.trim().length>0")) return;
        } catch { return; }
        if (window.isDestroyed() || window.webContents.isDestroyed()) return;
        const child = cp.spawn(helper, ["--maintenance-confirm", root, current], { windowsHide: true, stdio: "ignore" });
        child.on("error", error => console.warn("[CodexInstall] Startup confirmation failed", error));
        child.once("spawn", () => { confirmed = true; });
        child.unref();
      }, 30000);
      timer.unref?.();
    });
  };
  app.on("browser-window-created", (_event, window) => observe(window));
  return false;
}

module.exports = { windowsInstallLifecycle };
