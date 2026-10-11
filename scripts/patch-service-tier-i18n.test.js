#!/usr/bin/env node
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { patchServiceTierI18nSource } = require("./patch-service-tier-i18n");

const fixture =
  "const m={ultrafastDescription:{id:`serviceTier.ultrafast.description`," +
  "defaultMessage:`The fastest available responses for latency-sensitive work`}};" +
  "function description(e){switch(e?.name){case`ultrafast`:return e?.description??m.ultrafastDescription;case null:return null}}";

test("localizes the repeated remote ultrafast fallback and preserves custom copy", () => {
  const first = patchServiceTierI18nSource(fixture);
  assert.equal(first.status, "patched");
  const description = Function(`${first.code};return description`)();
  const fallback = "The fastest available responses for latency-sensitive work";

  assert.equal(description({ name: "ultrafast" }).defaultMessage, fallback);
  assert.equal(
    description({
      name: "ultrafast",
      description: "The fastest available responses for latency-sensitive work.",
    }).defaultMessage,
    fallback,
  );
  assert.equal(
    description({ name: "ultrafast", description: "A model-specific description" }),
    "A model-specific description",
  );

  const second = patchServiceTierI18nSource(first.code);
  assert.equal(second.status, "already");
  assert.equal(second.code, first.code);
});

test("fails closed on ambiguous service tier implementations", () => {
  assert.throws(
    () => patchServiceTierI18nSource(`${fixture};${fixture}`),
    /expected exactly once, found 2/,
  );
});

test("supports the new shared-bundle fallback and preserves empty-string semantics", () => {
  for (const operator of ["??", "||"]) {
    const source = fixture.replace("e?.description??", `e?.description${operator}`);
    const result = patchServiceTierI18nSource(source);
    const description = Function(`${result.code};return description`)();
    assert.equal(description({ name: "ultrafast", description: "The fastest available responses for latency-sensitive work" }).id, "serviceTier.ultrafast.description");
    const empty = description({ name: "ultrafast", description: "" });
    assert.equal(operator === "||" ? empty.id : empty, operator === "||" ? "serviceTier.ultrafast.description" : "");
    assert.equal(patchServiceTierI18nSource(result.code).status, "already");
  }
});

test("finds the moved service tier implementation in app-shared", () => {
  const sandbox = {
    module: { exports: {} },
    require: (name) => name === "node:fs" ? {
      existsSync: () => true,
      readdirSync: () => ["app-initial-decoy.js", "app-shared-new.js"],
      readFileSync: (file) => file.endsWith("app-shared-new.js") ? fixture : "",
    } : name === "./patch-util" ? { SRC_DIR: "fixture", relPath: (file) => file } : require(name),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "patch-service-tier-i18n.js"), "utf8"), sandbox);
  const targets = sandbox.module.exports.locateTargets("win");
  assert.equal(targets.length, 1);
  assert.equal(path.basename(targets[0].path), "app-shared-new.js");
});
