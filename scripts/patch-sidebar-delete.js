#!/usr/bin/env node
/**
 * Add a sidebar hover delete button that delegates to the native
 * `delete-thread` menu item. The official dialog and deletion flow stay the
 * single source of truth.
 */
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");
const { relPath, SRC_DIR } = require("./patch-util");

const MARKER = "id:`thread-delete-action`";
const TRASH_PATH_PREFIX = "M10.6299 1.33496";

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (node.type) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (["type", "start", "end"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value?.type) walk(value, visit);
  }
}

function parse(source) {
  return acorn.parse(source, { ecmaVersion: 2022, sourceType: "module" });
}

function findOwnedFunctions(source, ast) {
  const functions = [];
  walk(ast, (node) => {
    if (node.type === "FunctionDeclaration") functions.push(node);
  });
  const hover = functions.filter((node) => {
    const body = source.slice(node.start, node.end);
    return (
      body.includes("thread-primary-action") &&
      body.includes("getMenuItems") &&
      body.includes("leadingAction") &&
      body.includes("trailingAction")
    );
  });
  if (hover.length !== 1 || !hover[0].id) {
    throw new Error(`expected one native sidebar action rail, found ${hover.length}`);
  }
  const row = functions.filter((node) => {
    const body = source.slice(node.start, node.end);
    return (
      body.includes("`row-actions`") &&
      body.includes("additionalHoverActionCount") &&
      body.includes(`)(${hover[0].id.name},{`)
    );
  });
  if (row.length !== 1) {
    throw new Error(`expected one native sidebar row, found ${row.length}`);
  }
  return { hover: hover[0], row: row[0] };
}

function findTrashIcon(source) {
  let marker = -1;
  while ((marker = source.indexOf(TRASH_PATH_PREFIX, marker + 1)) !== -1) {
    const start = source.lastIndexOf("function ", marker);
    const prefix = source.slice(start, marker);
    const initializer = prefix.match(/^function ([\w$]+)\(\)/)?.[1];
    const component = [...prefix.matchAll(/([\w$]+)=e=>/g)].at(-1)?.[1];
    if (initializer && component) return { initializer, component };
  }
  throw new Error("official trash icon binding changed");
}

function patchHover(source, node, trash) {
  let code = source.slice(node.start, node.end);
  const props = /\{archive:([\w$]+),primaryAction:([\w$]+),getMenuItems:([\w$]+),/;
  const propsMatch = code.match(props);
  if (!propsMatch) throw new Error("native sidebar action props changed");
  code = code.replace(
    props,
    `{archive:$1,deleteAction:CodexDeleteAction,primaryAction:$2,getMenuItems:$3,`,
  );

  const empty = /if\(([^;]+)\)return null;/;
  const emptyMatch = code.match(empty);
  if (!emptyMatch) throw new Error("native sidebar empty-action guard changed");
  code = code.replace(empty, `if(${emptyMatch[1]}&&CodexDeleteAction==null)return null;`);

  const jsx = code.match(/icon:\(0,([\w$]+)\.jsx\)\(/)?.[1];
  const intl = code.match(/=([\w$]+)\(\);if\(/)?.[1];
  if (!jsx || !intl) throw new Error("native sidebar render bindings changed");
  const aggregateMatch = code.match(
    /let ([\w$]+);(?=[^;]*?\[\.\.\.([\w$]+),\.\.\.([\w$]+)\])/,
  );
  if (!aggregateMatch) throw new Error("native sidebar action aggregation changed");
  const [, actions, pinActions, archiveActions] = aggregateMatch;
  const aggregateEnd = code.indexOf(";let ", aggregateMatch.index + aggregateMatch[0].length);
  if (aggregateEnd === -1) throw new Error("native sidebar action aggregation end changed");
  const replacement =
    `let ${actions}=[...${pinActions},...${archiveActions},...CodexDeleteAction==null?[]:[{` +
    `${MARKER},ariaLabel:CodexDeleteAction.message==null?\`Permanently delete\`:` +
    `${intl}.formatMessage(CodexDeleteAction.message),` +
    `buttonClassName:\`text-token-error-foreground hover:text-token-error-foreground\`,` +
    `icon:(${trash.initializer}(),(0,${jsx}.jsx)(${trash.component},{})),` +
    `onClick:CodexDeleteAction.onSelect}]];`;
  return code.slice(0, aggregateMatch.index) + replacement + code.slice(aggregateEnd + 1);
}

function patchRow(source, node, hoverName) {
  let code = source.slice(node.start, node.end);
  const menu = /getMenuItems:([\w$]+)\?\(\)=>?([\w$]+)\(`row-actions`\):void 0/;
  const menuMatch = code.match(menu);
  if (!menuMatch) throw new Error("native sidebar menu factory changed");
  const menuFactory = menuMatch[2];
  const hoverCall = new RegExp(`\\)\\(${hoverName.replace(/[$]/g, "\\$")},\\{`);
  if (!hoverCall.test(code)) throw new Error("native sidebar action rail call changed");
  code = code.replace(
    hoverCall,
    `)(${hoverName},{deleteAction:${menuFactory}(\`row-actions\`).find(e=>e.id===\`delete-thread\`),`,
  );

  const countProp = code.match(/additionalHoverActionCount:([\w$]+)/)?.[1];
  if (!countProp) throw new Error("native sidebar hover count prop changed");
  const count = new RegExp(`(let |[,;])${countProp}=([^,;]+)`);
  const countMatch = code.match(count);
  if (!countMatch) throw new Error("native sidebar hover count binding changed");
  return code.replace(
    count,
    `${countMatch[1]}${countProp}=(${countMatch[2]})+(${menuFactory}(\`row-actions\`).some(e=>e.id===\`delete-thread\`)?1:0)`,
  );
}

function patchSidebarSource(source) {
  const markerCount = source.split(MARKER).length - 1;
  if (markerCount === 1) return { status: "already", code: source };
  if (markerCount !== 0) throw new Error(`sidebar delete marker count is ${markerCount}`);
  if (!source.includes("id:`delete-thread`")) {
    throw new Error("native delete-thread menu item is missing");
  }

  const { hover, row } = findOwnedFunctions(source, parse(source));
  const trash = findTrashIcon(source);
  const replacements = [
    { start: hover.start, end: hover.end, code: patchHover(source, hover, trash) },
    { start: row.start, end: row.end, code: patchRow(source, row, hover.id.name) },
  ].sort((a, b) => b.start - a.start);
  let code = source;
  for (const replacement of replacements) {
    code = code.slice(0, replacement.start) + replacement.code + code.slice(replacement.end);
  }
  if (code.split(MARKER).length - 1 !== 1) {
    throw new Error("sidebar delete postcondition failed");
  }
  return { status: "patched", code };
}

function findTarget(platform) {
  const directory = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  if (!fs.existsSync(directory)) throw new Error(`missing sidebar assets for ${platform}`);
  const candidates = fs.readdirSync(directory).filter((name) => /^app-initial-.*\.js$/.test(name)).flatMap((name) => {
    const file = path.join(directory, name);
    const source = fs.readFileSync(file, "utf8");
    return source.includes("thread-primary-action") && source.includes("id:`delete-thread`")
      ? [{ file, source }]
      : [];
  });
  if (candidates.length !== 1) {
    throw new Error(`expected one native sidebar bundle for ${platform}, found ${candidates.length}`);
  }
  return candidates[0];
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const requested = args.find((arg) => ["mac-arm64", "mac-x64", "win"].includes(arg));
  const platforms = requested
    ? [requested]
    : ["mac-arm64", "mac-x64", "win"].filter((platform) =>
        fs.existsSync(path.join(SRC_DIR, platform, "_asar")),
      );
  if (platforms.length === 0) throw new Error("sidebar-delete expected at least one platform");
  for (const platform of platforms) {
    const target = findTarget(platform);
    const result = patchSidebarSource(target.source);
    if (!isCheck && result.code !== target.source) fs.writeFileSync(target.file, result.code, "utf8");
    console.log(`  [${platform}] ${isCheck ? "check" : result.status}: ${relPath(target.file)}`);
  }
}

if (require.main === module) main();

module.exports = { patchSidebarSource };
