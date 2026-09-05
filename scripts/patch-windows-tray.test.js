const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { patchWindowsTraySource } = require("./patch-windows-tray");

const SOURCE = "new electron.Tray(icons.defaultIcon,process.platform===`win32`&&electron.app.isPackaged?getGuid(flavor):void 0)";

test("unsigned Windows tray creation never supplies a path-bound GUID", () => {
  const patched = patchWindowsTraySource(SOURCE);
  assert.equal(patched.status, "patched");
  const calls = [];
  for (const execPath of ["C:/Codex/app-1/ChatGPT.exe", "C:/Codex/app-2/ChatGPT.exe"]) {
    vm.runInNewContext(patched.code, {
      process: { platform: "win32", execPath },
      icons: { defaultIcon: "icon.ico" },
      electron: { app: { isPackaged: true }, Tray: class { constructor(...args) { calls.push(args); } } },
      getGuid() { throw new Error("Must not reuse the official GUID"); },
    });
  }
  assert.deepEqual(calls, [["icon.ico"], ["icon.ico"]]);
  assert.deepEqual(patchWindowsTraySource(patched.code), { code: patched.code, status: "already" });
  assert.throws(() => patchWindowsTraySource(SOURCE + ";" + SOURCE), /exactly 1/);
  assert.throws(() => patchWindowsTraySource(SOURCE.replace("defaultIcon", "otherIcon")), /icon argument/);
  assert.throws(() => patchWindowsTraySource(SOURCE.replace("getGuid(flavor)", "`new-guid`")), /GUID argument/);
  assert.throws(() => patchWindowsTraySource("const text='new electron.Tray()';"), /found 0/);
});
