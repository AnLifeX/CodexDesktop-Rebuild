#!/usr/bin/env node
/**
 * Close the per-capture Windows Appshot helper on legacy Windows.
 *
 * Windows 10 19045 cannot suppress the Graphics Capture privacy border. The
 * normal screenshot path already uses the GDI fallback; Appshot used the
 * long-lived native helper instead, so its capture session could leave the
 * yellow border visible. Use a fresh helper only for each legacy Appshot and
 * close it after the completion event. Newer Windows keeps the upstream
 * shared helper path.
 */
const fs = require("node:fs");
const { locateBundles, relPath } = require("./patch-util");

const FUNCTION_ANCHOR =
  "function qit({decorateApp:e=async()=>null,loadHelperTransport:t})";
const SHARED_TRANSPORT_LOAD = "let e=c,n=t(e.signal).then";
const ORIGINAL_CAPTURE =
  "try{let t=await M7(d(),o),r=Zit(e,f.window,f.decoration,i,s),a=await v(t,f,r,o);if(a==null)return null;let{transitionId:l,...p}=a,m={emitUpdate:n,signal:o==null?c.signal:AbortSignal.any([o,c.signal]),transitionId:l,transport:t,window:f.window},h=g(m);return u.add(h),h.finally(()=>u.delete(h)),{result:`started`,...p}}catch(e){return o?.aborted||D7().warning(`Windows Appshot start failed`,{safe:{requestId:a},sensitive:{error:e}}),null}";
const PATCHED_CAPTURE =
  "let closeCaptureTransport=Number(process.getSystemVersion().split(`.`)[2])<20348,captureTransport;try{captureTransport=await M7(closeCaptureTransport?loadHelperTransport(o):d(),o);let r=Zit(e,f.window,f.decoration,i,s),a=await v(captureTransport,f,r,o);if(a==null){closeCaptureTransport&&await captureTransport.close().catch(()=>void 0);return null}let{transitionId:l,...p}=a,m={emitUpdate:n,signal:o==null?c.signal:AbortSignal.any([o,c.signal]),transitionId:l,transport:captureTransport,window:f.window},h=g(m);return u.add(h),h.finally(async()=>{u.delete(h);closeCaptureTransport&&await captureTransport.close().catch(()=>void 0)}),{result:`started`,...p}}catch(e){closeCaptureTransport&&captureTransport?.close().catch(()=>void 0),o?.aborted||D7().warning(`Windows Appshot start failed`,{safe:{requestId:a},sensitive:{error:e}}),null}";

function patchMainSource(source) {
  if (source.includes("closeCaptureTransport=Number(process.getSystemVersion")) {
    return source.replace(SHARED_TRANSPORT_LOAD, "let e=c,n=loadHelperTransport(e.signal).then");
  }
  if (!source.includes(FUNCTION_ANCHOR)) {
    throw new Error("Windows Appshot bridge function anchor changed");
  }
  if (!source.includes(ORIGINAL_CAPTURE)) {
    throw new Error("Windows Appshot capture implementation changed");
  }
  return source
    .replace(FUNCTION_ANCHOR, "function qit({decorateApp:e=async()=>null,loadHelperTransport})")
    .replace(SHARED_TRANSPORT_LOAD, "let e=c,n=loadHelperTransport(e.signal).then")
    .replace(ORIGINAL_CAPTURE, PATCHED_CAPTURE);
}

function main() {
  const args = process.argv.slice(2);
  const platform = args.find((arg) =>
    ["mac-arm64", "mac-x64", "win", "unix"].includes(arg),
  );
  if (platform && platform !== "win") return;
  const bundles = locateBundles({
    dir: "build",
    pattern: /^main-.*\.js$/,
    platform: platform === "win" ? "win" : undefined,
  });
  if (bundles.length === 0) {
    if (platform === "win") throw new Error("Windows main bundle is missing");
    console.log("  [ok] No Windows main bundle found");
    return;
  }
  for (const { path: target } of bundles) {
    const original = fs.readFileSync(target, "utf8");
    const patched = patchMainSource(original);
    if (!args.includes("--check")) fs.writeFileSync(target, patched);
    console.log(
      `  [ok] ${relPath(target)}: ${args.includes("--check") ? "legacy Appshot cleanup is applicable" : patched === original ? "legacy Appshot cleanup already patched" : "installed legacy Appshot cleanup"}`,
    );
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[x] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { FUNCTION_ANCHOR, ORIGINAL_CAPTURE, PATCHED_CAPTURE, patchMainSource };
