#!/usr/bin/env node
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ORIGINAL_CAPTURE,
  LATEST_FUNCTION_ANCHOR,
  latestCapture,
  patchMainSource,
} = require("./patch-windows-appshot-win10");

const FUNCTION_ANCHOR = "function qit({decorateApp:e=async()=>null,loadHelperTransport:t})";

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
