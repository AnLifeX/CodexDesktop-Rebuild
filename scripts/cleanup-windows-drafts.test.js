#!/usr/bin/env node
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  extractSourceRunId,
  isManagedWindowsDraft,
  planScheduledCleanup,
  shouldDeleteScheduledDraft,
} = require("./cleanup-windows-drafts");

const NOW = new Date("2026-08-31T12:00:00Z");

function draft(overrides = {}) {
  return {
    id: 1,
    draft: true,
    tag_name: "codex-win-26.825.41651",
    body: "<!-- codex-rebuild-run-id:123 -->",
    created_at: "2026-08-20T00:00:00Z",
    ...overrides,
  };
}

test("cleanup only recognizes marked Windows application and staging drafts", () => {
  assert.equal(extractSourceRunId(draft()), "123");
  assert.equal(isManagedWindowsDraft(draft()), true);
  assert.equal(isManagedWindowsDraft(draft({ draft: false })), false);
  assert.equal(isManagedWindowsDraft(draft({ tag_name: "windows-update-feed" })), false);
  assert.equal(isManagedWindowsDraft(draft({ tag_name: "v26.825.41651" })), false);
});

test("failed drafts expire after one day while successful drafts expire after seven", () => {
  const recent = draft({ created_at: "2026-08-31T00:00:00Z" });
  const twoDaysOld = draft({ created_at: "2026-08-29T00:00:00Z" });
  const eightDaysOld = draft({ created_at: "2026-08-23T00:00:00Z" });
  const failed = { status: "completed", conclusion: "failure" };
  const success = { status: "completed", conclusion: "success" };

  assert.equal(shouldDeleteScheduledDraft(recent, failed, NOW), false);
  assert.equal(shouldDeleteScheduledDraft(twoDaysOld, failed, NOW), true);
  assert.equal(shouldDeleteScheduledDraft(twoDaysOld, success, NOW), false);
  assert.equal(shouldDeleteScheduledDraft(eightDaysOld, success, NOW), true);
});

test("active and unmarked drafts are never removed by scheduled cleanup", () => {
  const old = draft();
  assert.equal(shouldDeleteScheduledDraft(old, { status: "in_progress", conclusion: null }, NOW), false);
  assert.equal(shouldDeleteScheduledDraft({ ...old, body: "no marker" }, null, NOW), false);
});

test("scheduled planning resolves one Actions run for both drafts", async () => {
  let calls = 0;
  const api = {
    async getRun(runId) {
      calls += 1;
      assert.equal(runId, "123");
      return { status: "completed", conclusion: "cancelled" };
    },
  };
  const planned = await planScheduledCleanup(
    api,
    [draft(), draft({ id: 2, tag_name: "windows-update-feed-staging-26.825.41651" })],
    NOW,
  );
  assert.equal(calls, 1);
  assert.deepEqual(planned.map(({ release }) => release.id), [1, 2]);
});
