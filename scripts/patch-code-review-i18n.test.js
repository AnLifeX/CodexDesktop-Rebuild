const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { parse } = require("acorn");
const { localizeCodeReviewResource, patchCodeReviewI18nSource } = require("./patch-code-review-i18n");

const URI = "ui://pull-requests/app.js";
const SOURCE = 'async function bridge(e){switch(e.method){case`resources/read`:{let p=validate(e.params);return authorize(p),read(scope,host,{server:view.server,uri:p.uri,threadId:id},{widget:metadata},before)}}}';
const TEXT = 'const messages=[{id:"settings.codeReviewPlugin.githubLinks.label",defaultMessage:"Open review links in"},{id:"privateReview.instructions.placeholder",defaultMessage:"For example: I care most about the data model. Tell me where we might be overcomplicating things."},{id:"codeReview.settings.provider.github",defaultMessage:"GitHub"},{id:"unrelated",defaultMessage:"Keep \\"quoted\\" text"}];';

test("translates only Code Review settings descriptors, preserving metadata and other resources", () => {
  const other = { uri: "other", text: TEXT };
  const result = { _meta: { retained: true }, contents: [{ uri: URI, mimeType: "text/javascript", text: TEXT }, other] };
  const patched = localizeCodeReviewResource(result, "code-review", URI, "zh-CN");
  assert.equal(patched._meta, result._meta);
  assert.equal(patched.contents[1], other);
  assert.equal(result.contents[0].text, TEXT);
  const messages = new Function(patched.contents[0].text + ";return messages")();
  assert.deepEqual(messages.map((message) => message.defaultMessage), [
    "审查链接打开方式",
    "例如：我最关注数据模型。请指出哪些地方可能设计得过于复杂。",
    "GitHub",
    'Keep "quoted" text',
  ]);
});

test("preserves other locales, plugins, resource types and malformed responses", () => {
  const result = { contents: [{ uri: URI, text: TEXT }] };
  for (const [server, uri, locale] of [["other", URI, "zh-CN"], ["code-review", "other", "zh-CN"], ["code-review", URI, "en-US"]]) {
    assert.equal(localizeCodeReviewResource(result, server, uri, locale), result);
  }
  for (const result of [null, {}, { contents: null }]) {
    assert.equal(localizeCodeReviewResource(result, "code-review", URI, "zh-CN"), result);
  }
  const blob = { uri: URI, blob: "unchanged" };
  assert.equal(localizeCodeReviewResource({ contents: [blob] }, "code-review", URI, "zh-CN").contents[0], blob);
});

test("injected bridge preserves authorization, request arguments and rejection behavior", async () => {
  const first = patchCodeReviewI18nSource(SOURCE);
  parse(first.code, { ecmaVersion: "latest", sourceType: "module" });
  const calls = [];
  const create = new Function("validate", "authorize", "read", "scope", "host", "view", "id", "metadata", "before", "document", first.code + ";return bridge");
  const error = new Error("read failed");
  let reject = false;
  const bridge = create((params) => params, () => calls.push("authorize"), async (...args) => {
    calls.push(args);
    if (reject) throw error;
    return { contents: [{ uri: URI, text: TEXT }] };
  }, "scope", "host", { server: "code-review" }, "thread", "metadata", "before", { documentElement: { lang: "zh-CN" } });
  const result = await bridge({ method: "resources/read", params: { uri: URI } });
  assert(result.contents[0].text.includes("审查链接打开方式"));
  assert.equal(calls[0], "authorize");
  assert.deepEqual(calls[1], ["scope", "host", { server: "code-review", uri: URI, threadId: "thread" }, { widget: "metadata" }, "before"]);
  reject = true;
  await assert.rejects(bridge({ method: "resources/read", params: { uri: URI } }), (failure) => failure === error);
  assert.equal(patchCodeReviewI18nSource(first.code).code, first.code);
});

test("fails closed for missing or ambiguous resource bridges", () => {
  assert.throws(() => patchCodeReviewI18nSource("const empty=1"), /expected exactly once/);
  assert.throws(() => patchCodeReviewI18nSource(SOURCE + SOURCE.replace("bridge", "other")), /found 2/);
});

test("keeps the older host resource override while translating the server fallback", () => {
  const source = SOURCE.replace(
    "return authorize(p),read(scope,host,{server:view.server,uri:p.uri,threadId:id},{widget:metadata},before)",
    "return override==null?(authorize(p),read(scope,host,{server:view.server,uri:p.uri,threadId:id},{widget:metadata},before)):{contents:[{...override,uri:p.uri}]}",
  );
  const patched = patchCodeReviewI18nSource(source);
  parse(patched.code, { ecmaVersion: "latest", sourceType: "module" });
  assert(patched.code.includes(':{contents:[{...override,uri:p.uri}]}'));
  assert(patched.code.includes('before).then(result=>localizeCodeReviewResource'));
});

test("standard patch pipeline includes Code Review translation after the catalog", () => {
  const pipeline = fs.readFileSync(require.resolve("./patch-all"), "utf8");
  assert(pipeline.indexOf('"patch-code-review-i18n.js"') > pipeline.indexOf('"patch-zh-cn-catalog.js"'));
});
