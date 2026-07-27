const fs = require("node:fs");
const path = require("node:path");

const ESCAPED_PATH_SEGMENT = /%[0-9a-f]{2}/i;

function decodeEscapedResourceName(name) {
  if (typeof name !== "string" || !ESCAPED_PATH_SEGMENT.test(name)) return name;
  let decoded;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return name;
  }
  if (
    decoded.length === 0 ||
    decoded === "." ||
    decoded === ".." ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes("\0")
  ) {
    throw new Error(`unsafe decoded Windows resource path segment: ${name}`);
  }
  return decoded;
}

function normalizeEscapedResourcePaths(rootDir) {
  const counts = { directories: 0, files: 0, total: 0 };
  if (!fs.existsSync(rootDir)) return counts;

  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const oldPath = path.join(dir, entry.name);
      const decodedName = decodeEscapedResourceName(entry.name);
      const nextPath = path.join(dir, decodedName);
      if (nextPath !== oldPath) {
        if (fs.existsSync(nextPath)) {
          throw new Error(
            `decoded Windows resource path collides with an existing entry: ${nextPath}`,
          );
        }
        fs.renameSync(oldPath, nextPath);
        if (entry.isDirectory()) counts.directories += 1;
        else counts.files += 1;
        counts.total += 1;
      }
      if (entry.isDirectory()) visit(nextPath);
    }
  };

  visit(rootDir);
  return counts;
}

module.exports = {
  decodeEscapedResourceName,
  normalizeEscapedResourcePaths,
};
