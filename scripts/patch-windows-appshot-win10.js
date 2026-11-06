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
const { parse } = require("acorn");
const { locateBundles, relPath } = require("./patch-util");

const FUNCTION_ANCHOR =
  "function qit({decorateApp:e=async()=>null,loadHelperTransport:t})";
const LATEST_FUNCTION_ANCHOR =
  "function Wit({decorateApp:e=async()=>null,loadHelperTransport:t})";
const SHARED_TRANSPORT_LOAD = /let e=c,([\w$]+)=t\(e\.signal\)\.then/g;
const ORIGINAL_CAPTURE =
  "try{let t=await M7(d(),o),r=Zit(e,f.window,f.decoration,i,s),a=await v(t,f,r,o);if(a==null)return null;let{transitionId:l,...p}=a,m={emitUpdate:n,signal:o==null?c.signal:AbortSignal.any([o,c.signal]),transitionId:l,transport:t,window:f.window},h=g(m);return u.add(h),h.finally(()=>u.delete(h)),{result:`started`,...p}}catch(e){return o?.aborted||D7().warning(`Windows Appshot start failed`,{safe:{requestId:a},sensitive:{error:e}}),null}";
const PATCHED_CAPTURE =
  "let closeCaptureTransport=Number(process.getSystemVersion().split(`.`)[2])<20348,captureTransport;try{captureTransport=await M7(closeCaptureTransport?loadHelperTransport(o):d(),o);let r=Zit(e,f.window,f.decoration,i,s),a=await v(captureTransport,f,r,o);if(a==null){closeCaptureTransport&&await captureTransport.close().catch(()=>void 0);return null}let{transitionId:l,...p}=a,m={emitUpdate:n,signal:o==null?c.signal:AbortSignal.any([o,c.signal]),transitionId:l,transport:captureTransport,window:f.window},h=g(m);return u.add(h),h.finally(async()=>{u.delete(h);closeCaptureTransport&&await captureTransport.close().catch(()=>void 0)}),{result:`started`,...p}}catch(e){closeCaptureTransport&&captureTransport?.close().catch(()=>void 0),o?.aborted||D7().warning(`Windows Appshot start failed`,{safe:{requestId:a},sensitive:{error:e}}),null}";

function latestCapture(source) {
  return source.replaceAll("M7(", "P7(").replaceAll("Zit(", "Jit(")
    .replaceAll("D7().warning", "k7().warning");
}

function patchMainSource(source) {
  if (source.includes("function({decorateApp:")) return patchWebpackSource(source);
  if (source.includes("closeCaptureTransport=Number(process.getSystemVersion")) {
    return source.replace(SHARED_TRANSPORT_LOAD, "let e=c,$1=loadHelperTransport(e.signal).then");
  }
  const anchors = source.match(/function [\w$]+\(\{decorateApp:e=async\(\)=>null,loadHelperTransport:t\}\)/g) ?? [];
  if (anchors.length !== 1) {
    throw new Error("Windows Appshot bridge function anchor changed");
  }
  const anchor = anchors[0];
  const captureMatches = [...source.matchAll(/try\{let t=await ([\w$]+)\(d\(\),o\),([\w$]+)=([\w$]+)\(e,f\.window,f\.decoration,i,s\),a=await ([\w$]+)\(t,f,\2,o\)/g)];
  const loggerMatches = [...source.matchAll(/\|\|([\w$]+)\(\)\.warning\(`Windows Appshot start failed`/g)];
  const sharedLoads = [...source.matchAll(SHARED_TRANSPORT_LOAD)];
  if (captureMatches.length !== 1 || loggerMatches.length !== 1 || sharedLoads.length !== 1) {
    throw new Error("Windows Appshot capture implementation changed");
  }
  const [, transport, decoration, decorate, startCapture] = captureMatches[0];
  // 26.1013 reuses the old decoration name for the update callback. Resolve
  // each binding independently, then require the entire capture body to match.
  const emitter = source.slice(captureMatches[0].index).match(/m=\{emitUpdate:([\w$]+),signal:/)?.[1];
  if (!emitter) throw new Error("Windows Appshot capture implementation changed");
  const rename = (capture) => capture.replaceAll("M7(", `${transport}(`)
    .replaceAll("r=Zit(", `${decoration}=${decorate}(`)
    .replaceAll("f,r,o)", `f,${decoration},o)`)
    .replaceAll("v(", `${startCapture}(`)
    .replaceAll("emitUpdate:n,", `emitUpdate:${emitter},`)
    .replaceAll("D7().warning", `${loggerMatches[0][1]}().warning`);
  const originalCapture = rename(ORIGINAL_CAPTURE);
  const patchedCapture = rename(PATCHED_CAPTURE);
  if (source.split(originalCapture).length !== 2) {
    throw new Error("Windows Appshot capture implementation changed");
  }
  return source
    .replace(anchor, anchor.replace("loadHelperTransport:t", "loadHelperTransport"))
    .replace(SHARED_TRANSPORT_LOAD, "let e=c,$1=loadHelperTransport(e.signal).then")
    .replace(originalCapture, patchedCapture);
}

function patchWebpackSource(source) {
  if (source.includes("/* CodexRebuildAppshotWebpack */")) return source;
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "script" });
  const find = (root, predicate) => {
    const matches = [];
    function visit(node) {
      if (!node || typeof node !== "object") return;
      if (node.type && predicate(node)) matches.push(node);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
      }
    }
    visit(root);
    return matches;
  };
  const one = (nodes, label) => {
    if (nodes.length !== 1) throw new Error(`Windows Appshot ${label} expected 1 target, found ${nodes.length}`);
    return nodes[0];
  };
  const text = node => source.slice(node.start, node.end);
  const bridge = one(find(ast, node => node.type === "FunctionExpression" &&
    text(node).startsWith("function({decorateApp:") && text(node).includes("Windows Appshot start failed")), "bridge");
  const helper = one(bridge.params[0].properties.filter(node => node.key.name === "loadHelperTransport"), "helper");
  const acquisition = one(find(bridge.body, node => node.type === "CallExpression" &&
    node.callee.type === "Identifier" && node.callee.name === helper.value.name &&
    node.arguments.length === 1 && node.arguments[0].type === "MemberExpression" &&
    node.arguments[0].property.name === "signal"), "shared acquisition");
  const capture = one(find(bridge.body, node => node.type === "Property" && node.key.name === "startCapture"), "capture").value;
  const attempt = one(find(capture.body, node => node.type === "TryStatement" &&
    text(node.handler).includes("Windows Appshot start failed")), "capture try");
  const transport = attempt.block.body[0].declarations?.[0]?.init;
  if (transport?.type !== "AwaitExpression" || transport.argument.type !== "CallExpression" ||
      transport.argument.arguments.length !== 2) throw new Error("Windows Appshot transport changed");
  const [shared, signal] = transport.argument.arguments;
  if (shared.type !== "CallExpression" || shared.arguments.length !== 0) throw new Error("Windows Appshot shared getter changed");
  const completion = one(find(attempt.block, node => node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" && node.callee.property.name === "finally"), "completion");
  const callback = completion.arguments[0];
  if (callback?.type !== "ArrowFunctionExpression" || callback.body.type !== "CallExpression") {
    throw new Error("Windows Appshot completion changed");
  }
  // Only returns owned by startCapture release its transport; nested capture helpers have their own null paths.
  const ownReturns = (root) => {
    const returns = [];
    function visit(node) {
      if (!node || typeof node !== "object" || /^(?:Function|ArrowFunction)/.test(node.type)) return;
      if (node.type === "ReturnStatement") returns.push(node);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
      }
    }
    visit(root);
    return returns;
  };
  const empty = one(ownReturns(attempt.block).filter(node => node.type === "ReturnStatement" &&
    node.argument?.type === "Literal" && node.argument.value === null), "empty result");
  const cleanup = "if(closeCaptureTransport&&captureTransport)await captureTransport.close().catch(()=>void 0);";
  const changes = [
    { start: helper.value.start, end: helper.value.end, code: "loadHelperTransport" },
    { start: acquisition.callee.start, end: acquisition.callee.end, code: "loadHelperTransport" },
    { start: attempt.start, end: attempt.start, code: "/* CodexRebuildAppshotWebpack */let closeCaptureTransport=Number(process.getSystemVersion().split(`.`)[2])<20348,captureTransport;" },
    { start: transport.start, end: transport.end, code: `captureTransport=await ${text(transport.argument.callee)}(closeCaptureTransport?loadHelperTransport(${text(signal)}):${text(shared)},${text(signal)})` },
    { start: empty.start, end: empty.end, code: `{${cleanup}return null}` },
    { start: callback.start, end: callback.end, code: `async()=>{try{return ${text(callback.body)}}finally{${cleanup}}}` },
    { start: attempt.handler.body.start + 1, end: attempt.handler.body.start + 1, code: cleanup },
  ];
  for (const change of changes.sort((a,b) => b.start-a.start)) {
    source = source.slice(0, change.start) + change.code + source.slice(change.end);
  }
  parse(source, { ecmaVersion: "latest", sourceType: "script" });
  return source;
}

function main() {
  const args = process.argv.slice(2);
  const platform = args.find((arg) =>
    ["mac-arm64", "mac-x64", "win", "unix"].includes(arg),
  );
  if (platform && platform !== "win") return;
  const bundles = locateBundles({
    dir: "build",
    pattern: /^(?:main-.*|early-bootstrap-\d+-[\da-f]+)\.js$/,
    contains: "Windows Appshot start failed",
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

module.exports = { FUNCTION_ANCHOR, LATEST_FUNCTION_ANCHOR, ORIGINAL_CAPTURE, PATCHED_CAPTURE, latestCapture, patchMainSource };
