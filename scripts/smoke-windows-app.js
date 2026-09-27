#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { resolvePrimaryExecutableNameFromManifest } = require("./windows-app-entry");

const root = path.join(__dirname, "..", "out");
const manifest = fs.readFileSync(path.join(root, ".windows-msix", "AppxManifest.xml"), "utf8");
const exe = path.join(root, "win", "Codex-win32-x64", resolvePrimaryExecutableNameFromManifest(manifest));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "codex-smoke-"));
const app = spawn(exe, [`--user-data-dir=${profile}`, "--remote-debugging-port=0"], {
  stdio: "ignore",
  windowsHide: true,
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function inspectPage(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => { socket.close(); reject(new Error("renderer inspection timed out")); }, 5000);
    socket.onopen = () => socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: "({root:!!document.querySelector('#root')?.firstElementChild,text:document.body?.innerText?.trim().length??0})",
        returnByValue: true,
      },
    }));
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) reject(new Error("renderer JavaScript failed"));
      else resolve(message.result?.result?.value);
    };
    socket.onerror = () => { clearTimeout(timeout); reject(new Error("renderer connection failed")); };
  });
}

async function main() {
  let last = "window has not rendered";
  for (let attempt = 0; attempt < 60; attempt++) {
    if (app.exitCode != null) throw new Error(`app exited before rendering (${app.exitCode})`);
    const portFile = path.join(profile, "DevToolsActivePort");
    if (fs.existsSync(portFile)) {
      const port = fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0];
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = pages.find((item) => item.type === "page" && item.url === "app://-/index.html");
        if (page) {
          const rendered = await inspectPage(page.webSocketDebuggerUrl);
          if (rendered?.root && rendered.text > 10) {
            console.log(`[ok] Windows app rendered (${rendered.text} visible characters)`);
            return;
          }
          last = `root=${rendered?.root} visible characters=${rendered?.text}`;
        }
      } catch (error) {
        last = error.message;
      }
    }
    await pause(1000);
  }
  throw new Error(`Windows app did not render in 60 seconds: ${last}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (app.pid) {
    try { execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  }
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (error) {
    console.warn(`Could not remove smoke profile: ${error.message}`);
  }
});
