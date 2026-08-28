#!/usr/bin/env node
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { validateWindowsReleaseFeed } = require("./validate-windows-release-feed");

const VERSION = "3.0.0";

function createFeed(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-release-feed-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, entries: [] };
}

function addPackage(feed, version, kind, size) {
  const fileName = `Codex-${version}-${kind}.nupkg`;
  const body = Buffer.alloc(size, `${version}:${kind}`);
  const sha1 = crypto.createHash("sha1").update(body).digest("hex");
  fs.writeFileSync(path.join(feed.root, fileName), body);
  const item = { fileName, kind, sha1, size: body.length, version };
  feed.entries.push(item);
  return item;
}

function writeFeed(feed, full, deltas, overrides = {}) {
  fs.writeFileSync(
    path.join(feed.root, "RELEASES"),
    `${feed.entries.map((item) => `${item.sha1} ${item.fileName} ${item.size}`).join("\n")}\n`,
  );
  fs.writeFileSync(
    path.join(feed.root, "delta-chain.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      latestVersion: VERSION,
      full: { fileName: full.fileName, sha1: full.sha1, size: full.size, version: VERSION },
      deltas,
      ...overrides,
    }, null, 2)}\n`,
  );
}

function edge(fromVersion, item) {
  return {
    fileName: item.fileName,
    fromVersion,
    sha1: item.sha1,
    size: item.size,
    toVersion: item.version,
  };
}

test("accepts latest full with a contiguous, smaller delta chain", async (t) => {
  const feed = createFeed(t);
  const delta2 = addPackage(feed, "2.0.0", "delta", 10);
  const delta3 = addPackage(feed, VERSION, "delta", 11);
  const full = addPackage(feed, VERSION, "full", 100);
  writeFeed(feed, full, [edge("1.0.0", delta2), edge("2.0.0", delta3)]);

  assert.deepEqual(await validateWindowsReleaseFeed({ root: feed.root, version: VERSION }), {
    full: { fileName: full.fileName, sha1: full.sha1, size: full.size },
    deltas: [
      { fileName: delta2.fileName, sha1: delta2.sha1, size: delta2.size },
      { fileName: delta3.fileName, sha1: delta3.sha1, size: delta3.size },
    ],
    deltaBytes: delta2.size + delta3.size,
  });
});

test("accepts a full-only feed", async (t) => {
  const feed = createFeed(t);
  const full = addPackage(feed, VERSION, "full", 100);
  writeFeed(feed, full, []);
  const result = await validateWindowsReleaseFeed({ root: feed.root, version: VERSION });
  assert.deepEqual(result.deltas, []);
  assert.equal(result.deltaBytes, 0);
});

test("rejects a missing, broken, or mismatched chain manifest", async (t) => {
  await t.test("missing manifest", async (t) => {
    const feed = createFeed(t);
    const full = addPackage(feed, VERSION, "full", 100);
    fs.writeFileSync(path.join(feed.root, "RELEASES"), `${full.sha1} ${full.fileName} ${full.size}\n`);
    await assert.rejects(
      () => validateWindowsReleaseFeed({ root: feed.root, version: VERSION }),
      /delta-chain\.json is missing/i,
    );
  });

  await t.test("non-contiguous chain", async (t) => {
    const feed = createFeed(t);
    const delta2 = addPackage(feed, "2.0.0", "delta", 10);
    const delta3 = addPackage(feed, VERSION, "delta", 10);
    const full = addPackage(feed, VERSION, "full", 100);
    writeFeed(feed, full, [edge("1.0.0", delta2), edge("2.5.0", delta3)]);
    await assert.rejects(
      () => validateWindowsReleaseFeed({ root: feed.root, version: VERSION }),
      /not contiguous/i,
    );
  });

  await t.test("manifest hash mismatch", async (t) => {
    const feed = createFeed(t);
    const delta = addPackage(feed, VERSION, "delta", 10);
    const full = addPackage(feed, VERSION, "full", 100);
    const bad = edge("2.0.0", delta);
    bad.sha1 = "0".repeat(40);
    writeFeed(feed, full, [bad]);
    await assert.rejects(
      () => validateWindowsReleaseFeed({ root: feed.root, version: VERSION }),
      /sha1 does not match/i,
    );
  });
});

test("rejects a delta chain whose total is not smaller than full", async (t) => {
  const feed = createFeed(t);
  const delta2 = addPackage(feed, "2.0.0", "delta", 60);
  const delta3 = addPackage(feed, VERSION, "delta", 50);
  const full = addPackage(feed, VERSION, "full", 100);
  writeFeed(feed, full, [edge("1.0.0", delta2), edge("2.0.0", delta3)]);
  await assert.rejects(
    () => validateWindowsReleaseFeed({ root: feed.root, version: VERSION }),
    /not smaller than the full/i,
  );
});

test("rejects package size/hash mismatches and unreferenced packages", async (t) => {
  await t.test("package hash", async (t) => {
    const feed = createFeed(t);
    const full = addPackage(feed, VERSION, "full", 100);
    writeFeed(feed, full, []);
    fs.appendFileSync(path.join(feed.root, full.fileName), "tampered");
    await assert.rejects(
      () => validateWindowsReleaseFeed({ root: feed.root, version: VERSION }),
      /size mismatch/i,
    );
  });

  await t.test("unreferenced package", async (t) => {
    const feed = createFeed(t);
    const full = addPackage(feed, VERSION, "full", 100);
    writeFeed(feed, full, []);
    fs.writeFileSync(path.join(feed.root, "Codex-2.0.0-delta.nupkg"), "old");
    await assert.rejects(
      () => validateWindowsReleaseFeed({ root: feed.root, version: VERSION }),
      /unreferenced/i,
    );
  });
});
