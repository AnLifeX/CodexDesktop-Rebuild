#!/usr/bin/env node
/**
 * Keep OwlWebViewEnhancements enabled across remote feature-cache refreshes.
 *
 * The Electron main process already supports a list of locally forced Owl
 * features. Add the webview-enhancements feature to that list so the browser
 * sidebar can create more than one tab without depending on the Statsig gate.
 */
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("acorn");
const { SRC_DIR, relPath } = require("./patch-util");

const FEATURE_NAME = "OwlWebViewEnhancements";
const CACHE_FILE_NAME = "owl-feature-bootstrap-cache.json";
const MARKER = "CodexRebuildOwlMultiBrowser";
const PLATFORMS = ["mac-arm64", "mac-x64", "win"];

function walk(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (node.type) visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end") continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child?.type) walk(child, visitor);
      }
    } else if (value?.type) {
      walk(value, visitor);
    }
  }
}

function staticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (
    node?.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function hasStaticString(node, value) {
  let found = false;
  walk(node, (child) => {
    if (staticString(child) === value) found = true;
  });
  return found;
}

function bootstrapParameterName(node) {
  const parameter = node.params?.[0];
  if (
    parameter?.type !== "AssignmentPattern" ||
    parameter.left.type !== "Identifier" ||
    parameter.right.type !== "ArrayExpression" ||
    parameter.right.elements.length !== 0
  ) {
    return null;
  }
  return parameter.left.name;
}

function bootstrapPresetCall(node, parameterName) {
  const statement = node.body?.body?.[0];
  const assignment = statement?.type === "ExpressionStatement"
    ? statement.expression
    : null;
  if (
    assignment?.type !== "AssignmentExpression" ||
    assignment.operator !== "=" ||
    assignment.left.type !== "Identifier" ||
    assignment.right.type !== "CallExpression" ||
    assignment.right.arguments.length !== 1
  ) {
    return null;
  }
  return {
    assignment,
    argument: assignment.right.arguments[0],
    parameterName,
  };
}

function isBootstrapFunction(node, source) {
  if (
    node.type !== "FunctionDeclaration" &&
    node.type !== "FunctionExpression" &&
    node.type !== "ArrowFunctionExpression"
  ) {
    return false;
  }
  const bodySource = source.slice(node.body.start, node.body.end);
  return (
    bodySource.includes("enabledFeatureNames") &&
    bodySource.includes("disabledFeatureNames") &&
    hasStaticString(node.body, "enable-features") &&
    hasStaticString(node.body, "disable-features")
  );
}

function isForcedFeatureArray(node, parameterName) {
  if (node?.type !== "ArrayExpression" || node.elements.length !== 2) {
    return false;
  }
  const [spread, feature] = node.elements;
  return (
    spread?.type === "SpreadElement" &&
    spread.argument.type === "Identifier" &&
    spread.argument.name === parameterName &&
    staticString(feature) === FEATURE_NAME
  );
}

function analyzeOwlBootstrapSource(source) {
  const comments = [];
  let ast;
  try {
    ast = parse(source, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowHashBang: true,
      onComment: comments,
    });
  } catch (error) {
    throw new Error(`owl multi-browser parse failed: ${error.message}`);
  }

  if (!hasStaticString(ast, CACHE_FILE_NAME)) {
    return { state: "irrelevant", code: source, patches: [] };
  }

  const markerComments = comments.filter((comment) =>
    comment.value.includes(MARKER),
  );
  const exactMarkers = markerComments.filter(
    (comment) => comment.type === "Block" && comment.value.trim() === MARKER,
  );
  if (markerComments.length !== exactMarkers.length || exactMarkers.length > 1) {
    throw new Error("owl multi-browser marker postcondition is malformed");
  }

  const candidates = [];
  walk(ast, (node) => {
    if (!isBootstrapFunction(node, source)) return;
    const parameterName = bootstrapParameterName(node);
    if (parameterName == null) return;
    const preset = bootstrapPresetCall(node, parameterName);
    if (preset != null) candidates.push({ node, ...preset });
  });

  if (candidates.length !== 1) {
    throw new Error(
      `owl multi-browser bootstrap expected exactly 1 target, found ${candidates.length}`,
    );
  }

  const target = candidates[0];
  const argument = target.argument;
  const markerInTarget = exactMarkers.some(
    (comment) => comment.start >= argument.start && comment.end <= argument.end,
  );

  if (isForcedFeatureArray(argument, target.parameterName)) {
    if (exactMarkers.length === 1 && !markerInTarget) {
      throw new Error("owl multi-browser marker is detached from the live target");
    }
    return {
      state: "already",
      code: source,
      patches: [],
      counts: { patchable: 0, already: 1, total: 1 },
    };
  }

  if (
    argument.type !== "Identifier" ||
    argument.name !== target.parameterName
  ) {
    throw new Error("owl multi-browser bootstrap preset has an unexpected shape");
  }
  if (exactMarkers.length !== 0) {
    throw new Error("owl multi-browser marker exists without a forced feature");
  }

  const replacement =
    `[...${target.parameterName},\`${FEATURE_NAME}\`` +
    `/* ${MARKER} */]`;
  return {
    state: "patchable",
    code: source,
    patches: [{ start: argument.start, end: argument.end, replacement }],
    counts: { patchable: 1, already: 0, total: 1 },
  };
}

function patchOwlBootstrapSource(source) {
  const analysis = analyzeOwlBootstrapSource(source);
  if (analysis.state === "irrelevant") {
    throw new Error("owl multi-browser bootstrap cache contract was not found");
  }
  if (analysis.state === "already") {
    return { ...analysis, status: "already" };
  }

  let code = source;
  for (const patch of [...analysis.patches].sort((a, b) => b.start - a.start)) {
    code = code.slice(0, patch.start) + patch.replacement + code.slice(patch.end);
  }
  const verified = analyzeOwlBootstrapSource(code);
  if (verified.state !== "already" || verified.counts.total !== 1) {
    throw new Error("owl multi-browser post-patch validation failed");
  }
  return {
    ...verified,
    code,
    status: "patched",
    patches: analysis.patches,
    counts: { patchable: 1, already: 0, total: 1 },
  };
}

function requestedPlatforms(platform) {
  if (platform === "unix") return ["mac-arm64", "mac-x64"];
  if (platform != null) return [platform];
  return PLATFORMS.filter((name) =>
    fs.existsSync(path.join(SRC_DIR, name, "_asar", ".vite", "build")),
  );
}

function locateTargets(platform) {
  const platforms = requestedPlatforms(platform);
  const targets = [];
  for (const platformName of platforms) {
    const buildDir = path.join(
      SRC_DIR,
      platformName,
      "_asar",
      ".vite",
      "build",
    );
    if (!fs.existsSync(buildDir)) continue;
    for (const fileName of fs.readdirSync(buildDir)) {
      if (!fileName.endsWith(".js")) continue;
      const filePath = path.join(buildDir, fileName);
      const source = fs.readFileSync(filePath, "utf8");
      if (
        !source.includes(CACHE_FILE_NAME) ||
        !source.includes("enable-features") ||
        !source.includes("disable-features")
      ) {
        continue;
      }
      targets.push({ platform: platformName, path: filePath, source });
    }
  }
  return targets;
}

function planTargets(platform) {
  const platforms = requestedPlatforms(platform).filter((platformName) =>
    fs.existsSync(
      path.join(SRC_DIR, platformName, "_asar", ".vite", "build"),
    ),
  );
  if (platforms.length === 0) {
    throw new Error("owl multi-browser expected at least one platform");
  }
  const targets = locateTargets(platform);
  return platforms.map((platformName) => {
    const matches = targets.filter((target) => target.platform === platformName);
    if (matches.length !== 1) {
      throw new Error(
        `owl multi-browser expected exactly 1 target bundle for ${platformName}, found ${matches.length}`,
      );
    }
    const target = matches[0];
    return { ...target, result: patchOwlBootstrapSource(target.source) };
  });
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((arg) =>
    [...PLATFORMS, "unix"].includes(arg),
  );
  const plans = planTargets(platform);

  for (const plan of plans) {
    console.log(
      `  [${plan.platform}] ${isCheck ? "check" : plan.result.status}: ` +
        `${relPath(plan.path)} (forced ${FEATURE_NAME})`,
    );
  }
  if (!isCheck) {
    for (const plan of plans) {
      if (plan.result.code !== plan.source) {
        fs.writeFileSync(plan.path, plan.result.code, "utf8");
      }
    }
  }
  console.log(
    `  [ok] owl multi-browser contract satisfied for ${plans.length} platform(s)`,
  );
}

if (require.main === module) main();

module.exports = {
  CACHE_FILE_NAME,
  FEATURE_NAME,
  MARKER,
  analyzeOwlBootstrapSource,
  locateTargets,
  patchOwlBootstrapSource,
  planTargets,
};
