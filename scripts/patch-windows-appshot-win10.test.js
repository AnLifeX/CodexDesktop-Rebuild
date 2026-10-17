#!/usr/bin/env node
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const {
  ORIGINAL_CAPTURE,
  LATEST_FUNCTION_ANCHOR,
  latestCapture,
  patchMainSource,
} = require("./patch-windows-appshot-win10");

const FUNCTION_ANCHOR = "function qit({decorateApp:e=async()=>null,loadHelperTransport:t})";
// Capture body from 26.1013: the decoration and update callback swapped names.
const CAPTURE_1013 = "try{let t=await W7(d(),o),n=m2e(e,f.window,f.decoration,i,s),a=await v(t,f,n,o);if(a==null)return null;let{transitionId:l,...p}=a,m={emitUpdate:r,signal:o==null?c.signal:AbortSignal.any([o,c.signal]),transitionId:l,transport:t,window:f.window},h=g(m);return u.add(h),h.finally(()=>u.delete(h)),{result:`started`,...p}}catch(e){return o?.aborted||z7().warning(`Windows Appshot start failed`,{safe:{requestId:a},sensitive:{error:e}}),null}";

test("uses a one-shot helper for Appshot on legacy Windows and closes it", () => {
  const source = `${FUNCTION_ANCHOR}let e=c,n=t(e.signal).thenxxx${ORIGINAL_CAPTURE}`;
  const patched = patchMainSource(source);
  assert.match(patched, /loadHelperTransport\(o\)/);
  assert.match(patched, /n=loadHelperTransport\(e\.signal\)\.then/);
  assert.match(patched, /closeCaptureTransport&&await captureTransport\.close\(\)/);
  assert.equal(patchMainSource(patched), patched);
});

test("fails closed when the upstream Appshot bridge changes", () => {
  assert.throws(() => patchMainSource("export {};"), /function anchor changed/);
  assert.throws(
    () => patchMainSource(`${FUNCTION_ANCHOR}xxx`),
    /capture implementation changed/,
  );
});

test("patches the latest Windows Appshot bridge", () => {
  const source = `${LATEST_FUNCTION_ANCHOR}let e=c,n=t(e.signal).thenxxx${latestCapture(ORIGINAL_CAPTURE)}`;
  const patched = patchMainSource(source);
  assert.match(patched, /function Wit\(\{decorateApp:e=async\(\)=>null,loadHelperTransport\}\)/);
  assert.match(patched, /await P7\(closeCaptureTransport\?loadHelperTransport\(o\):d\(\),o\)/);
  assert.match(patched, /r=Jit\(e,f\.window/);
  assert.equal(patchMainSource(patched), patched);
});

test("patches the renamed bridge and capture helper in the new upstream", () => {
  const source =
    "function oot({decorateApp:e=async()=>null,loadHelperTransport:t})" +
    "let e=c,n=t(e.signal).thenxxx" +
    ORIGINAL_CAPTURE.replaceAll("Zit(", "uot(").replaceAll("v(", "_(");
  const patched = patchMainSource(source);
  assert.match(patched, /await M7\(closeCaptureTransport\?loadHelperTransport\(o\):d\(\),o\)/);
  assert.match(patched, /r=uot\(e,f\.window/);
  assert.match(patched, /a=await _\(captureTransport,f,r,o\)/);
});

test("patches 26.1013 local bindings and preserves the update callback", () => {
  const source = "function u2e({decorateApp:e=async()=>null,loadHelperTransport:t})" +
    "let e=c,r=t(e.signal).thenxxx" + CAPTURE_1013;
  const patched = patchMainSource(source);
  assert.match(patched, /r=loadHelperTransport\(e\.signal\)\.then/);
  assert.match(patched, /let n=m2e\(e,f\.window/);
  assert.match(patched, /v\(captureTransport,f,n,o\)/);
  assert.match(patched, /emitUpdate:r,signal:/);
  assert.equal(patchMainSource(patched), patched);
  assert.throws(() => patchMainSource(source.replace("v(t,f,n,o)", "v(t,f,n,o,!0)")), /capture implementation changed/);
});

test("26.1013 closes only legacy per-capture helpers on completion, null and failure", async (t) => {
  for (const build of [19045, 22631]) {
    for (const outcome of ["started", "null", "error"]) await t.test(`${build}: ${outcome}`, async () => {
      let loaded = 0, sharedLoads = 0, closed = 0;
      const helper = { close: async () => { closed++; } };
      let complete;
      const completion = new Promise(resolve => { complete = resolve; });
      const emitUpdate = () => {};
      const context = vm.createContext({
        AbortController, AbortSignal,
        process: { getSystemVersion: () => `10.0.${build}` },
        W7: async value => value,
        m2e: () => ({ decoration: true }),
        v: async () => {
          if (outcome === "error") throw new Error("capture failed");
          return outcome === "null" ? null : { transitionId: "test", id: "capture" };
        },
        z7: () => ({ warning: () => {} }),
        shared: helper, emitUpdate, completion,
        loadShared: () => { sharedLoads++; return helper; },
      });
      const source = "function bridge({decorateApp:e=async()=>null,loadHelperTransport:t}){" +
        "const c=new AbortController(),u=new Set(),r=emitUpdate;" +
        "function acquire(){let e=c,r=t(e.signal).then(x=>x);return r}" +
        "const d=loadShared,g=m=>{if(m.emitUpdate!==r)throw Error('callback changed');return completion};" +
        "return {async capture(){const e={},f={window:{},decoration:{}},i='test',o=undefined,s=false,a='request';" +
        CAPTURE_1013 + "}}}";
      const bridge = vm.runInContext(patchMainSource(source) + ";bridge", context)({
        loadHelperTransport: async () => { loaded++; return helper; },
      });
      const result = await bridge.capture();
      assert.equal(result?.result ?? null, outcome === "started" ? "started" : null);
      if (outcome === "started") {
        assert.equal(closed, 0, "helper remains open until completion");
        complete();
      }
      if (outcome === "started") await completion;
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(loaded, build < 20348 ? 1 : 0);
      assert.equal(sharedLoads, build < 20348 ? 0 : 1);
      assert.equal(closed, build < 20348 ? 1 : 0);
    });
  }
});
