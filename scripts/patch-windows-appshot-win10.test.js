#!/usr/bin/env node
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ORIGINAL_CAPTURE,
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
