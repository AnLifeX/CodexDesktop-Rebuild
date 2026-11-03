#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("acorn");
const { SRC_DIR, relPath } = require("./patch-util");

const MARKER = "/* CodexRebuildLocalArchiveIdentity */";
const ANCHOR = "Could not determine the account for worktree cleanup.";

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (node.type) visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}

function patchLocalArchiveSource(source) {
  if (!source.includes(ANCHOR)) throw new Error("Local archive manager is missing");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "script" });
  const targets = [];
  walk(ast, node => {
    if (node.type !== "MethodDefinition" || !node.value.async) return;
    const body = source.slice(node.start, node.end);
    if (!["getCachedAuthenticatedPrincipal", "getAuthenticatedPrincipal", "getAccount"].every(name => body.includes(name))) return;
    const account = body.match(/\{account:([\w$]+),requiresOpenaiAuth:([\w$]+)\}=await [\w$]+\.getAccount\(\)/);
    if (!account) throw new Error("Local archive account lookup changed");
    walk(node.value.body, child => {
      const owner = child.consequent;
      if (child.type === "ConditionalExpression" &&
          (owner.type === "Literal" && owner.value === "apikey" ||
            owner.type === "TemplateLiteral" && owner.expressions.length === 0 && owner.quasis[0].value.cooked === "apikey") &&
          child.alternate.type === "Literal" && child.alternate.value === null) {
        targets.push({ test: child.test, account: account[1], requiresAuth: account[2] });
      }
    });
  });
  if (targets.length !== 1) throw new Error(`Local archive identity expected 1 target, found ${targets.length}`);
  const { test, account, requiresAuth } = targets[0];
  const original = source.slice(test.start, test.end);
  const legacyTests = [
    `${account}?.type===\`apiKey\`||${requiresAuth}===!1`,
    `${account}?.type==="apiKey"||!1===${requiresAuth}`,
  ];
  const markerCount = source.split(MARKER).length - 1;
  const originalTest = legacyTests.find(text => original === text || original === `(${text})||${account}?.type==="chatgpt"`);
  if (!originalTest) throw new Error("Local archive identity fallback changed");
  const patchedTest = `(${originalTest})||${account}?.type==="chatgpt"`;
  if (markerCount === 1 && original === patchedTest) return { code: source, status: "already" };
  if (markerCount !== 0 || original !== originalTest) throw new Error("Local archive identity marker is detached or ambiguous");
  // A relay can report ChatGPT without JWT identity; reuse upstream's local API-key owner only after real identity lookup failed.
  const code = source.slice(0, test.start) + `(${patchedTest})${MARKER}` + source.slice(test.end);
  parse(code, { ecmaVersion: "latest", sourceType: "script" });
  return { code, status: "patched" };
}

function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => ["unix", "mac-arm64", "mac-x64"].includes(arg))) return;
  const directory = path.join(SRC_DIR, "win", "_asar", ".vite", "build");
  if (!fs.existsSync(directory) && !args.includes("win")) return;
  const targets = fs.readdirSync(directory).filter(name => name.endsWith(".js") &&
    fs.readFileSync(path.join(directory, name), "utf8").includes(ANCHOR));
  if (targets.length !== 1) throw new Error(`Local archive bundle expected 1 target, found ${targets.length}`);
  const file = path.join(directory, targets[0]);
  const result = patchLocalArchiveSource(fs.readFileSync(file, "utf8"));
  if (!args.includes("--check") && result.status === "patched") fs.writeFileSync(file, result.code);
  console.log(`  [${args.includes("--check") ? "check" : result.status}] ${relPath(file)}: local archive identity`);
}

if (require.main === module) main();
module.exports = { ANCHOR, patchLocalArchiveSource };
