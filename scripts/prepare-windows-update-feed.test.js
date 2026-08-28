#!/usr/bin/env node
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  DELTA_CHAIN_FILE,
  prepareWindowsUpdateFeed,
} = require("./prepare-windows-update-feed");

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-update-feed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const dest = path.join(root, "dest");
  fs.mkdirSync(source, { recursive: true });
  return { root, source, dest };
}

function addPackage(fixture, version, kind, size) {
  const fileName = `Codex-${version}-${kind}.nupkg`;
  const body = Buffer.alloc(size, `${version}:${kind}`);
  fs.writeFileSync(path.join(fixture.source, fileName), body);
  return {
    filename: fileName,
    kind,
    line: `${crypto.createHash("sha1").update(body).digest("hex")} ${fileName} ${body.length}`,
    sha1: crypto.createHash("sha1").update(body).digest("hex"),
    size: body.length,
    version,
  };
}

function writeSourceReleases(fixture, entries) {
  fs.writeFileSync(
    path.join(fixture.source, "RELEASES"),
    `${entries.map((entry) => entry.line).join("\n")}\n`,
  );
}

function writePreviousManifest(fixture, latestVersion, edges) {
  const file = path.join(fixture.root, "previous-delta-chain.json");
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, latestVersion, deltas: edges }));
  return file;
}

test("publishes the newly generated delta when no previous chain manifest exists", (t) => {
  const fixture = createFixture(t);
  const previousFull = addPackage(fixture, "1.0.0", "full", 100);
  const latestDelta = addPackage(fixture, "2.0.0", "delta", 10);
  const latestFull = addPackage(fixture, "2.0.0", "full", 100);
  writeSourceReleases(fixture, [previousFull, latestDelta, latestFull]);

  const result = prepareWindowsUpdateFeed({ source: fixture.source, dest: fixture.dest });

  assert.deepEqual(
    result.manifest.deltas.map(({ fromVersion, toVersion }) => [fromVersion, toVersion]),
    [["1.0.0", "2.0.0"]],
  );
  assert.deepEqual(
    fs.readdirSync(fixture.dest).sort(),
    [DELTA_CHAIN_FILE, "RELEASES", latestDelta.filename, latestFull.filename].sort(),
  );
});

test("keeps a contiguous delta suffix and the latest full package", (t) => {
  const fixture = createFixture(t);
  const full1 = addPackage(fixture, "1.0.0", "full", 100);
  const delta2 = addPackage(fixture, "2.0.0", "delta", 10);
  const delta3 = addPackage(fixture, "3.0.0", "delta", 11);
  const full3 = addPackage(fixture, "3.0.0", "full", 100);
  writeSourceReleases(fixture, [full1, delta2, delta3, full3]);
  const previousManifest = writePreviousManifest(fixture, "2.0.0", [
    {
      fileName: delta2.filename,
      fromVersion: "1.0.0",
      sha1: delta2.sha1,
      size: delta2.size,
      toVersion: "2.0.0",
    },
  ]);

  const result = prepareWindowsUpdateFeed({
    source: fixture.source,
    dest: fixture.dest,
    previousManifest,
  });

  assert.deepEqual(
    result.manifest.deltas.map(({ fromVersion, toVersion }) => [fromVersion, toVersion]),
    [["1.0.0", "2.0.0"], ["2.0.0", "3.0.0"]],
  );
  assert.deepEqual(
    fs.readdirSync(fixture.dest).sort(),
    [DELTA_CHAIN_FILE, "RELEASES", delta2.filename, delta3.filename, full3.filename].sort(),
  );
});

test("caps the retained delta chain at five packages", (t) => {
  const fixture = createFixture(t);
  const entries = [];
  const edges = [];
  entries.push(addPackage(fixture, "1.0.0", "full", 1000));
  for (let version = 2; version <= 7; version++) {
    const delta = addPackage(fixture, `${version}.0.0`, "delta", 10);
    entries.push(delta);
    if (version <= 6) {
      edges.push({
        fileName: delta.filename,
        fromVersion: `${version - 1}.0.0`,
        sha1: delta.sha1,
        size: delta.size,
        toVersion: `${version}.0.0`,
      });
    }
  }
  entries.push(addPackage(fixture, "7.0.0", "full", 1000));
  writeSourceReleases(fixture, entries);
  const previousManifest = writePreviousManifest(fixture, "6.0.0", edges);

  const result = prepareWindowsUpdateFeed({ source: fixture.source, dest: fixture.dest, previousManifest });
  assert.equal(result.manifest.deltas.length, 5);
  assert.equal(result.manifest.deltas[0].fromVersion, "2.0.0");
  assert.equal(result.manifest.deltas.at(-1).toVersion, "7.0.0");
});

test("drops older deltas until the retained suffix is smaller than full", (t) => {
  const fixture = createFixture(t);
  const full1 = addPackage(fixture, "1.0.0", "full", 100);
  const delta2 = addPackage(fixture, "2.0.0", "delta", 60);
  const delta3 = addPackage(fixture, "3.0.0", "delta", 50);
  const full3 = addPackage(fixture, "3.0.0", "full", 100);
  writeSourceReleases(fixture, [full1, delta2, delta3, full3]);
  const previousManifest = writePreviousManifest(fixture, "2.0.0", [{
    fileName: delta2.filename,
    fromVersion: "1.0.0",
    sha1: delta2.sha1,
    size: delta2.size,
    toVersion: "2.0.0",
  }]);

  const result = prepareWindowsUpdateFeed({ source: fixture.source, dest: fixture.dest, previousManifest });
  assert.deepEqual(result.manifest.deltas.map((edge) => edge.fileName), [delta3.filename]);
  assert.equal(result.manifest.deltas[0].fromVersion, "2.0.0");
});
