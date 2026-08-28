#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { compareWindowsReleaseVersions } = require("./configure-windows-release-version");
const {
  DEFAULT_MAX_DELTAS,
  DELTA_CHAIN_FILE,
  DELTA_CHAIN_SCHEMA_VERSION,
} = require("./prepare-windows-update-feed");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root" || argument === "--version") {
      options[argument.slice(2)] = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.root || !options.version) {
    throw new Error("Usage: validate-windows-release-feed.js --root <dir> --version <version>");
  }
  return options;
}

async function sha1File(filePath) {
  const hash = crypto.createHash("sha1");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function parseDeclaredPackages(releasesPath, version) {
  const lines = fs.readFileSync(releasesPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 1 || lines.length > DEFAULT_MAX_DELTAS + 1) {
    throw new Error(
      `RELEASES must contain one full and at most ${DEFAULT_MAX_DELTAS} delta lines, found ${lines.length}`,
    );
  }

  const packages = new Map();
  let full = null;
  for (const line of lines) {
    const match = line.match(/^([A-Fa-f0-9]{40}) ([^\s]+) ([0-9]+)$/);
    if (!match) {
      throw new Error("Each RELEASES line must contain a 40-hex SHA1, package filename, and byte size");
    }
    const [, rawSha1, fileName, rawSize] = match;
    const packageMatch = fileName.match(
      /^Codex-(\d+\.\d+\.\d+(?:-r\d+)?)-(full|delta)\.nupkg$/,
    );
    const size = Number(rawSize);
    if (!packageMatch || !Number.isSafeInteger(size) || size <= 0) {
      throw new Error(`Invalid Windows update package entry: ${fileName}`);
    }
    if (packages.has(fileName)) throw new Error(`RELEASES contains duplicate package ${fileName}`);
    const declaration = {
      fileName,
      kind: packageMatch[2],
      sha1: rawSha1.toLowerCase(),
      size,
      version: packageMatch[1],
    };
    packages.set(fileName, declaration);
    if (declaration.kind === "full") {
      if (full) throw new Error("RELEASES contains more than one full package");
      if (declaration.version !== version) {
        throw new Error(`Full package version ${declaration.version} does not match requested ${version}`);
      }
      full = declaration;
    }
  }
  if (!full) throw new Error(`RELEASES is missing required full package Codex-${version}-full.nupkg`);
  return { full, packages };
}

function readAndValidateManifest(root, version, declarations) {
  const manifestPath = path.join(root, DELTA_CHAIN_FILE);
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    throw new Error(`${DELTA_CHAIN_FILE} is missing`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`${DELTA_CHAIN_FILE} is invalid JSON: ${error.message}`);
  }
  if (
    manifest?.schemaVersion !== DELTA_CHAIN_SCHEMA_VERSION ||
    manifest.latestVersion !== version ||
    !manifest.full ||
    !Array.isArray(manifest.deltas)
  ) {
    throw new Error(`${DELTA_CHAIN_FILE} has invalid schema or latest version`);
  }
  if (manifest.deltas.length > DEFAULT_MAX_DELTAS) {
    throw new Error(`${DELTA_CHAIN_FILE} contains more than ${DEFAULT_MAX_DELTAS} deltas`);
  }

  const full = declarations.full;
  for (const field of ["fileName", "sha1", "size"]) {
    if (manifest.full[field] !== full[field]) {
      throw new Error(`${DELTA_CHAIN_FILE} full ${field} does not match RELEASES`);
    }
  }
  if (manifest.full.version !== version) {
    throw new Error(`${DELTA_CHAIN_FILE} full version does not match ${version}`);
  }

  const declaredDeltas = [...declarations.packages.values()].filter((item) => item.kind === "delta");
  if (declaredDeltas.length !== manifest.deltas.length) {
    throw new Error(`${DELTA_CHAIN_FILE} delta count does not match RELEASES`);
  }

  let previousTarget = null;
  let deltaBytes = 0;
  const deltas = [];
  for (const edge of manifest.deltas) {
    if (
      typeof edge?.fromVersion !== "string" ||
      typeof edge?.toVersion !== "string" ||
      typeof edge?.fileName !== "string" ||
      compareWindowsReleaseVersions(edge.fromVersion, edge.toVersion) >= 0
    ) {
      throw new Error(`${DELTA_CHAIN_FILE} contains an invalid delta edge`);
    }
    if (previousTarget != null && edge.fromVersion !== previousTarget) {
      throw new Error(`${DELTA_CHAIN_FILE} delta chain is not contiguous`);
    }
    const expectedName = `Codex-${edge.toVersion}-delta.nupkg`;
    if (edge.fileName !== expectedName) {
      throw new Error(`${DELTA_CHAIN_FILE} delta filename does not match target ${edge.toVersion}`);
    }
    const declaration = declarations.packages.get(edge.fileName);
    if (!declaration || declaration.kind !== "delta") {
      throw new Error(`${DELTA_CHAIN_FILE} references undeclared delta ${edge.fileName}`);
    }
    for (const field of ["sha1", "size"]) {
      if (edge[field] !== declaration[field]) {
        throw new Error(`${DELTA_CHAIN_FILE} ${edge.fileName} ${field} does not match RELEASES`);
      }
    }
    previousTarget = edge.toVersion;
    deltaBytes += edge.size;
    deltas.push(declaration);
  }
  if (deltas.length > 0 && previousTarget !== version) {
    throw new Error(`${DELTA_CHAIN_FILE} delta chain does not end at ${version}`);
  }
  if (deltaBytes >= full.size) {
    throw new Error(`${DELTA_CHAIN_FILE} delta chain is not smaller than the full package`);
  }
  return { manifest, deltas, deltaBytes };
}

async function validateWindowsReleaseFeed({ root, version }) {
  const resolvedRoot = path.resolve(root);
  const releasesPath = path.join(resolvedRoot, "RELEASES");
  if (!fs.existsSync(releasesPath) || !fs.statSync(releasesPath).isFile()) {
    throw new Error(`RELEASES file is missing: ${releasesPath}`);
  }
  const declarations = parseDeclaredPackages(releasesPath, version);
  const chain = readAndValidateManifest(resolvedRoot, version, declarations);

  const referencedNames = new Set(declarations.packages.keys());
  const unreferencedPackages = fs.readdirSync(resolvedRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".nupkg"))
    .map((entry) => entry.name)
    .filter((fileName) => !referencedNames.has(fileName))
    .sort();
  if (unreferencedPackages.length > 0) {
    throw new Error(`Update feed contains unreferenced nupkg package(s): ${unreferencedPackages.join(", ")}`);
  }

  const verified = new Map();
  for (const declaration of declarations.packages.values()) {
    const packagePath = path.join(resolvedRoot, declaration.fileName);
    if (!fs.existsSync(packagePath) || !fs.statSync(packagePath).isFile()) {
      throw new Error(`RELEASES ${declaration.kind} package is missing: ${packagePath}`);
    }
    const actualSize = fs.statSync(packagePath).size;
    if (declaration.size !== actualSize) {
      throw new Error(
        `RELEASES ${declaration.kind} package size mismatch: declared ${declaration.size}, actual ${actualSize}`,
      );
    }
    const actualSha1 = await sha1File(packagePath);
    if (declaration.sha1 !== actualSha1) {
      throw new Error(
        `RELEASES ${declaration.kind} package SHA1 mismatch: declared ${declaration.sha1}, actual ${actualSha1}`,
      );
    }
    verified.set(declaration.fileName, {
      fileName: declaration.fileName,
      sha1: actualSha1,
      size: actualSize,
    });
  }

  return {
    full: verified.get(declarations.full.fileName),
    deltas: chain.deltas.map((item) => verified.get(item.fileName)),
    deltaBytes: chain.deltaBytes,
  };
}

function formatValidationResult(result) {
  return `full=${result.full.fileName}; deltas=${result.deltas.length}; deltaBytes=${result.deltaBytes}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await validateWindowsReleaseFeed(options);
  console.log(`[ok] validated Windows release feed: ${formatValidationResult(result)}`);
}

module.exports = { validateWindowsReleaseFeed };

if (require.main === module) {
  main().catch((error) => {
    console.error(`[x] ${error.message}`);
    process.exitCode = 1;
  });
}
