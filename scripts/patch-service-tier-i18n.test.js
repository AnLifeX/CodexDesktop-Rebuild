#!/usr/bin/env node
const assert = require("node:assert/strict");
const test = require("node:test");
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
