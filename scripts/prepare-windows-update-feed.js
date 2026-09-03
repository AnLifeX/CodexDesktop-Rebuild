#!/usr/bin/env node
/**
 * Prepare a compact Squirrel.Windows update feed.
 *
 * The feed keeps the newest full package plus a contiguous suffix of delta
 * packages. The suffix is capped by both count and total bytes so a client
 * never downloads a delta chain that is larger than the latest full package.
 */
const fs = require("fs");
const path = require("path");
const { compareWindowsReleaseVersions } = require("./configure-windows-release-version");

const DELTA_CHAIN_FILE = "delta-chain.json";
const DELTA_CHAIN_SCHEMA_VERSION = 1;
const DEFAULT_MAX_DELTAS = 5;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (["--source", "--dest", "--previous-manifest", "--max-deltas"].includes(arg)) {
      args[arg.slice(2)] = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.source || !args.dest) {
    throw new Error(
      "Usage: prepare-windows-update-feed.js --source <dir> --dest <dir> " +
        "[--previous-manifest <file>] [--max-deltas <count>]",
    );
  }
  const maxDeltas = args["max-deltas"] == null
    ? DEFAULT_MAX_DELTAS
    : Number(args["max-deltas"]);
  if (!Number.isSafeInteger(maxDeltas) || maxDeltas < 0 || maxDeltas > DEFAULT_MAX_DELTAS) {
    throw new Error(`--max-deltas must be an integer from 0 to ${DEFAULT_MAX_DELTAS}`);
  }
  return {
    source: path.resolve(args.source),
    dest: path.resolve(args.dest),
    previousManifest: args["previous-manifest"]
      ? path.resolve(args["previous-manifest"])
      : null,
    maxDeltas,
  };
}

function walkFiles(dir) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile()) files.push(filePath);
    }
  };
  visit(dir);
  return files;
}

function parseReleaseLine(line) {
  const match = line.trim().match(/^([A-Fa-f0-9]{40})\s+(\S+)\s+(\d+)$/);
  if (!match) return null;
  const [, sha1, filename, rawSize] = match;
  const packageMatch = filename.match(
    /^Codex-(\d+\.\d+\.\d+(?:-r\d+)?)-(full|delta)\.nupkg$/,
  );
  const size = Number(rawSize);
  if (!packageMatch || !Number.isSafeInteger(size) || size <= 0) return null;
  return {
    filename,
    kind: packageMatch[2],
    line: `${sha1.toLowerCase()} ${filename} ${size}`,
    sha1: sha1.toLowerCase(),
    size,
    version: packageMatch[1],
  };
}

function readPreviousManifest(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (
    manifest?.schemaVersion !== DELTA_CHAIN_SCHEMA_VERSION ||
    typeof manifest.latestVersion !== "string" ||
    !Array.isArray(manifest.deltas)
  ) {
    throw new Error(`Invalid previous delta chain manifest: ${filePath}`);
  }
  return manifest;
}

function selectDeltaChain({ entries, packageFiles, latestFull, previousManifest, maxDeltas }) {
  const deltasByVersion = new Map(
    entries
      .filter((entry) => entry.kind === "delta" && packageFiles.has(entry.filename))
      .map((entry) => [entry.version, entry]),
  );
  const edgesByTarget = new Map();

  for (const edge of previousManifest?.deltas || []) {
    if (
      typeof edge?.fromVersion !== "string" ||
      typeof edge?.toVersion !== "string" ||
      typeof edge?.fileName !== "string" ||
      compareWindowsReleaseVersions(edge.fromVersion, edge.toVersion) >= 0
    ) {
      continue;
    }
    const entry = deltasByVersion.get(edge.toVersion);
    if (entry?.filename === edge.fileName) {
      edgesByTarget.set(edge.toVersion, { fromVersion: edge.fromVersion, entry });
    }
  }

  const latestDelta = deltasByVersion.get(latestFull.version);
  if (latestDelta && !edgesByTarget.has(latestFull.version)) {
    let baseVersion = null;
    if (
      previousManifest?.latestVersion &&
      compareWindowsReleaseVersions(previousManifest.latestVersion, latestFull.version) < 0
    ) {
      baseVersion = previousManifest.latestVersion;
    } else {
      baseVersion = entries
        .filter(
          (entry) =>
            entry.kind === "full" &&
            entry.version !== latestFull.version &&
            packageFiles.has(entry.filename) &&
            compareWindowsReleaseVersions(entry.version, latestFull.version) < 0,
        )
        .map((entry) => entry.version)
        .sort(compareWindowsReleaseVersions)
        .at(-1) || null;
    }
    if (baseVersion) {
      edgesByTarget.set(latestFull.version, { fromVersion: baseVersion, entry: latestDelta });
    }
  }

  const selected = [];
  let cursor = latestFull.version;
  let totalBytes = 0;
  while (selected.length < maxDeltas) {
    const edge = edgesByTarget.get(cursor);
    if (!edge) break;
    if (totalBytes + edge.entry.size >= latestFull.size) break;
    selected.unshift({
      fileName: edge.entry.filename,
      fromVersion: edge.fromVersion,
      sha1: edge.entry.sha1,
      size: edge.entry.size,
      toVersion: edge.entry.version,
    });
    totalBytes += edge.entry.size;
    cursor = edge.fromVersion;
  }
  return { deltas: selected, totalBytes };
}

function prepareWindowsUpdateFeed({
  source,
  dest,
  previousManifest: previousManifestPath = null,
  maxDeltas = DEFAULT_MAX_DELTAS,
}) {
  if (!fs.existsSync(source)) throw new Error(`Source directory does not exist: ${source}`);

  const files = walkFiles(source).sort((left, right) => {
    const depth = (file) => path.relative(source, file).split(path.sep).length;
    return depth(right) - depth(left);
  });
  const packageFiles = new Map(
    files.filter((file) => file.endsWith(".nupkg")).map((file) => [path.basename(file), file]),
  );
  const entriesByFilename = new Map();
  for (const releaseFile of files.filter((file) => path.basename(file) === "RELEASES")) {
    for (const line of fs.readFileSync(releaseFile, "utf8").split(/\r?\n/)) {
      const entry = parseReleaseLine(line);
      if (entry) entriesByFilename.set(entry.filename, entry);
    }
  }
  const entries = Array.from(entriesByFilename.values());
  const latestFull = entries
    .filter((entry) => entry.kind === "full" && packageFiles.has(entry.filename))
    .sort((left, right) => compareWindowsReleaseVersions(left.version, right.version))
    .at(-1);
  if (!latestFull) throw new Error(`No available Squirrel full package found in ${source}`);

  const previousManifest = readPreviousManifest(previousManifestPath);
  const chain = selectDeltaChain({
    entries,
    packageFiles,
    latestFull,
    previousManifest,
    maxDeltas,
  });
  const selectedEntries = [
    ...chain.deltas.map((delta) => entriesByFilename.get(delta.fileName)),
    latestFull,
  ];

  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(
    path.join(dest, "RELEASES"),
    `${selectedEntries.map((entry) => entry.line).join("\n")}\n`,
  );
  for (const entry of selectedEntries) {
    fs.copyFileSync(packageFiles.get(entry.filename), path.join(dest, entry.filename));
  }

  const manifest = {
    schemaVersion: DELTA_CHAIN_SCHEMA_VERSION,
    latestVersion: latestFull.version,
    full: {
      fileName: latestFull.filename,
      sha1: latestFull.sha1,
      size: latestFull.size,
      version: latestFull.version,
    },
    deltas: chain.deltas,
  };
  fs.writeFileSync(
    path.join(dest, DELTA_CHAIN_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return {
    manifest,
    totalBytes: selectedEntries.reduce((sum, entry) => sum + entry.size, 0),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = prepareWindowsUpdateFeed(options);
  console.log(`Prepared Windows update feed ${result.manifest.latestVersion}:`);
  for (const delta of result.manifest.deltas) {
    console.log(`  ${delta.fileName} (${delta.fromVersion} -> ${delta.toVersion})`);
  }
  console.log(`  ${result.manifest.full.fileName}`);
  console.log(
    `Delta chain: ${result.manifest.deltas.length} package(s), ` +
      `${result.manifest.deltas.reduce((sum, item) => sum + item.size, 0)} bytes`,
  );
  console.log(`Total package size: ${(result.totalBytes / 1048576).toFixed(1)} MB`);
}

module.exports = {
  DEFAULT_MAX_DELTAS,
  DELTA_CHAIN_FILE,
  DELTA_CHAIN_SCHEMA_VERSION,
  parseReleaseLine,
  prepareWindowsUpdateFeed,
  selectDeltaChain,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[x] ${error.message}`);
    process.exitCode = 1;
  }
}
