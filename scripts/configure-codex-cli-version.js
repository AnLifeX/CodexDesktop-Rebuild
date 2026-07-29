#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const {
  parseCodexVersionOutput,
  readCodexBinaryVersion,
} = require("./codex-vendor");

const DEPENDENCY = "@openai/codex";

function parseArgs(argv) {
  const options = { writePackages: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--binary") options.binary = argv[++index];
    else if (arg === "--version") options.version = argv[++index];
    else if (arg === "--write-package") options.writePackages.push(argv[++index]);
    else if (arg === "--github-output") options.githubOutput = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (Boolean(options.binary) === Boolean(options.version)) {
    throw new Error("Exactly one of --binary or --version is required");
  }
  return options;
}

function validateVersion(version) {
  return parseCodexVersionOutput(`codex-cli ${version}`);
}

function updatePackageVersion(packageFile, version) {
  const resolved = path.resolve(packageFile);
  const packageJson = JSON.parse(fs.readFileSync(resolved, "utf8"));
  packageJson.optionalDependencies = {
    ...(packageJson.optionalDependencies || {}),
    [DEPENDENCY]: version,
  };
  fs.writeFileSync(resolved, `${JSON.stringify(packageJson, null, 2)}\n`);
  return resolved;
}

function writeGithubOutput(version, outputFile = process.env.GITHUB_OUTPUT) {
  if (!outputFile) throw new Error("GITHUB_OUTPUT is required with --github-output");
  fs.appendFileSync(outputFile, `codex_cli_version=${version}\n`);
}

function configure(options) {
  const version = options.binary
    ? readCodexBinaryVersion(path.resolve(options.binary))
    : validateVersion(options.version);
  const written = options.writePackages.map((file) => updatePackageVersion(file, version));
  if (options.githubOutput) writeGithubOutput(version);
  return { version, written };
}

function main() {
  const result = configure(parseArgs(process.argv.slice(2)));
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Official Codex CLI: ${result.version}`);
    for (const file of result.written) console.log(`Updated ${file}`);
  }
}

module.exports = {
  configure,
  parseArgs,
  updatePackageVersion,
  validateVersion,
  writeGithubOutput,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
