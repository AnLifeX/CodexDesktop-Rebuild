#!/usr/bin/env node
const fs = require("node:fs");
const { parse } = require("acorn");
const { locateBundles, relPath } = require("./patch-util");
const { ZH_CN_TRANSLATIONS } = require("./patch-zh-cn-catalog");

const MARKER = "/* CodexRebuildCodeReviewI18n */";
const REVIEW_TRANSLATIONS = Object.fromEntries([...ZH_CN_TRANSLATIONS].filter(([id]) =>
  /^(?:settings\.codeReviewPlugin\.|privateReview\.instructions\.|codeReview\.settings\.)/.test(id),
));

function localizeCodeReviewResource(result, server, uri, locale, translations = REVIEW_TRANSLATIONS) {
  if (server !== "code-review" || uri !== "ui://pull-requests/app.js" || locale !== "zh-CN") return result;
  if (!Array.isArray(result?.contents)) return result;
  return {
    ...result,
    contents: result.contents.map((resource) => resource.uri !== uri || typeof resource.text !== "string"
      ? resource
      : {
        ...resource,
        // shortcut: The bundled plugin emits compact quoted descriptors; update this match if its compiler output changes.
        text: resource.text.replace(/(\bid:"([^"]+)",defaultMessage:)"(?:\\.|[^"\\])*"/g,
          (match, prefix, id) => Object.hasOwn(translations, id) ? prefix + JSON.stringify(translations[id]) : match),
      }),
  };
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (node.type) visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value?.type) walk(value, visit);
  }
}

function patchCodeReviewI18nSource(source) {
  const markers = source.split(MARKER).length - 1;
  if (markers > 1) throw new Error("Duplicate Code Review i18n markers");
  if (markers === 1) return { code: source, status: "already" };
  const targets = [];
  walk(parse(source, { ecmaVersion: "latest", sourceType: "module" }), (node) => {
    if (node.type !== "SwitchCase") return;
    const method = node.test?.type === "Literal" ? node.test.value : node.test?.quasis?.[0]?.value.cooked;
    if (method !== "resources/read") return;
    const block = node.consequent[0];
    const statement = block?.type === "BlockStatement" && block.body.find((child) => child.type === "ReturnStatement");
    walk(statement?.argument, (call) => {
      if (call.type !== "CallExpression" || call.callee.type !== "Identifier") return;
      const options = call.arguments[2];
      if (options?.type !== "ObjectExpression") return;
      const property = (name) => options.properties.find((item) => item.key?.name === name)?.value;
      const server = property("server"), uri = property("uri");
      if (server?.type !== "MemberExpression" || uri?.type !== "MemberExpression") return;
      targets.push({ call, server, uri });
    });
  });
  if (targets.length !== 1) throw new Error(`MCP resource read bridge expected exactly once, found ${targets.length}`);
  const { call, server, uri } = targets[0];
  const replacement = source.slice(call.start, call.end) +
    `.then(result=>localizeCodeReviewResource(result,${source.slice(server.start, server.end)},${source.slice(uri.start, uri.end)},document.documentElement.lang))`;
  // Translate the served UI in the host bridge so signed plugin files and cached copies stay intact.
  const helper = localizeCodeReviewResource.toString().replace("= REVIEW_TRANSLATIONS", "= " + JSON.stringify(REVIEW_TRANSLATIONS));
  return { code: source.slice(0, call.start) + replacement + source.slice(call.end) + "\n" + MARKER + "\n" + helper, status: "patched" };
}

function main() {
  const args = process.argv.slice(2);
  const platform = args.find((value) => ["mac-arm64", "mac-x64", "win", "unix"].includes(value));
  const targets = platform === "unix"
    ? ["mac-arm64", "mac-x64"].flatMap((name) => locateBundles({ dir: "assets", pattern: /^view-frame-.*\.js$/, platform: name }))
    : locateBundles({ dir: "assets", pattern: /^view-frame-.*\.js$/, platform });
  for (const target of targets) {
    const source = fs.readFileSync(target.path, "utf8");
    const result = patchCodeReviewI18nSource(source);
    console.log(`  [${target.platform}] ${relPath(target.path)} (${result.status})`);
    if (!args.includes("--check") && result.code !== source) fs.writeFileSync(target.path, result.code, "utf8");
  }
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`[x] ${error.message}`); process.exitCode = 1; }
}

module.exports = { localizeCodeReviewResource, patchCodeReviewI18nSource };
