const fs = require("node:fs");
const path = require("node:path");
const { SRC_DIR } = require("./patch-util");

function windowsLogDirectory(local) {
  const path = require("node:path");
  const app = path.dirname(process.execPath), root = path.dirname(app);
  if (/^app-\d+\.\d+\.\d+(?:-r\d+|-rebuild\d+)?$/i.test(path.basename(app)) &&
      root.toLowerCase() === path.join(local, "Programs", "Codex").toLowerCase()) return path.join(root, "Logs");
  return path.join(local, "Codex", "Logs");
}

function patchSource(source) {
  if (source.includes("function windowsLogDirectory(")) return source;
  const pattern = /return\(0,[\w$]+\.join\)\(([\w$]+),`Codex`,`Logs`\)/g;
  if ([...source.matchAll(pattern)].length !== 1) throw new Error("Expected one Windows log directory expression");
  return source.replace(pattern, (_match, local) => `return(${windowsLogDirectory.toString()})(${local})`);
}

function main() {
  const platform = process.argv.slice(2).find(arg => ["win", "mac-arm64", "mac-x64", "unix"].includes(arg));
  if (platform && platform !== "win") return;
  const build = path.join(SRC_DIR, "win", "_asar", ".vite", "build");
  if (!fs.existsSync(build)) return;
  const files = fs.readdirSync(build).filter(name => /^(?:file-based-logger.*|worker)\.js$/.test(name));
  if (files.length !== 2) throw new Error("Expected Windows main and worker loggers");
  const changes = files.map(name => {
    const file = path.join(build, name), source = fs.readFileSync(file, "utf8");
    return { file, source, next: patchSource(source) };
  });
  for (const { file, source, next } of changes)
    if (!process.argv.includes("--check") && next !== source) fs.writeFileSync(file, next);
  console.log("[ok] Windows installed app logs follow Programs\\Codex");
}

if (require.main === module) main();
module.exports = { windowsLogDirectory, patchSource };
