#!/usr/bin/env node
/**
 * Keep the bundled Windows Computer Use helper compatible with Windows 10.
 *
 * The @oai/sky Windows helper queries the optional GraphicsCaptureSession interface that
 * owns IsBorderRequired before every screenshot. That interface was added in
 * Windows 10 build 20348, so Windows 10 22H2 (19045) returns E_NOINTERFACE and
 * the helper aborts an otherwise supported Windows.Graphics.Capture session.
 *
 * The helper is a proprietary, unsigned Rust executable with no source in the
 * upstream package. This narrowly patches the QI result handling so only
 * E_NOINTERFACE skips the optional border property. Supported systems still
 * call SetIsBorderRequired, and every other HRESULT keeps the original error
 * path. The patch fails closed if the PE layout or instruction anchors change.
 */
const fs = require("node:fs");
const path = require("node:path");
const { SRC_DIR, relPath } = require("./patch-util");

const E_NOINTERFACE = 0x80004002;
const ERROR_MARKER = Buffer.from("SetIsBorderRequired failed", "ascii");
const DEFAULT_TARGET = path.join(
  SRC_DIR,
  "win",
  "cua_node",
  "bin",
  "node_modules",
  "@oai",
  "sky",
  "bin",
  "windows",
  "codex-computer-use.exe",
);

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function readPeLayout(buffer) {
  if (buffer.length < 0x100 || buffer.toString("ascii", 0, 2) !== "MZ") {
    throw new Error("Computer Use helper is not a DOS/PE executable");
  }
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new Error("Computer Use helper has no PE signature");
  }

  const coffOffset = peOffset + 4;
  const sectionCount = buffer.readUInt16LE(coffOffset + 2);
  const optionalHeaderSize = buffer.readUInt16LE(coffOffset + 16);
  const optionalHeaderOffset = coffOffset + 20;
  if (buffer.readUInt16LE(optionalHeaderOffset) !== 0x20b) {
    throw new Error("Computer Use helper is not a PE32+ executable");
  }

  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
  const sections = [];
  for (let index = 0; index < sectionCount; index++) {
    const headerOffset = sectionTableOffset + index * 40;
    if (headerOffset + 40 > buffer.length) {
      throw new Error("Computer Use helper has a truncated section table");
    }
    const name = buffer
      .subarray(headerOffset, headerOffset + 8)
      .toString("ascii")
      .replace(/\0+$/, "");
    sections.push({
      headerOffset,
      name,
      virtualSize: buffer.readUInt32LE(headerOffset + 8),
      virtualAddress: buffer.readUInt32LE(headerOffset + 12),
      rawSize: buffer.readUInt32LE(headerOffset + 16),
      rawOffset: buffer.readUInt32LE(headerOffset + 20),
    });
  }

  const text = sections.find((section) => section.name === ".text");
  if (!text || text.rawOffset + text.rawSize > buffer.length) {
    throw new Error("Computer Use helper has no valid .text section");
  }
  return { sections, text };
}

function fileOffsetToRva(sections, fileOffset) {
  const section = sections.find(
    (candidate) =>
      fileOffset >= candidate.rawOffset &&
      fileOffset < candidate.rawOffset + candidate.rawSize,
  );
  if (!section) throw new Error(`File offset 0x${fileOffset.toString(16)} is outside PE sections`);
  return section.virtualAddress + fileOffset - section.rawOffset;
}

function findAll(buffer, needle, start = 0, end = buffer.length) {
  const offsets = [];
  let offset = start;
  while (offset < end) {
    const found = buffer.indexOf(needle, offset);
    if (found === -1 || found + needle.length > end) break;
    offsets.push(found);
    offset = found + 1;
  }
  return offsets;
}

function writeRelative32(buffer, instructionOffset, instructionSize, targetRva, instructionRva) {
  const displacement = targetRva - (instructionRva + instructionSize);
  if (displacement < -0x80000000 || displacement > 0x7fffffff) {
    throw new Error("Computer Use compatibility jump is outside rel32 range");
  }
  buffer.writeInt32LE(displacement, instructionOffset + instructionSize - 4);
}

function matchesBytes(buffer, offset, bytes) {
  if (offset < 0 || offset + bytes.length > buffer.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function locateBorderErrorXref(buffer, sections, text, markerRva) {
  const matches = [];
  const end = text.rawOffset + text.rawSize - 7;
  for (let offset = text.rawOffset; offset <= end; offset++) {
    if (!matchesBytes(buffer, offset, [0x4c, 0x8d, 0x05])) continue;
    const instructionRva = fileOffsetToRva(sections, offset);
    const targetRva = instructionRva + 7 + buffer.readInt32LE(offset + 3);
    if (targetRva === markerRva) matches.push(offset);
  }
  if (matches.length !== 1) {
    throw new Error(`Expected one SetIsBorderRequired error xref, found ${matches.length}`);
  }
  return matches[0];
}

function validateErrorContextTrailer(buffer, xrefOffset) {
  const fixed = [
    [7, 0x6a],
    [8, ERROR_MARKER.length],
    [9, 0x41],
    [10, 0x59],
    [11, 0xe8],
    [16, 0x90],
    [17, 0x48],
    [18, 0x89],
    [20, 0x48],
    [21, 0x85],
    [22, 0xc0],
    [23, 0x75],
  ];
  if (fixed.some(([relative, byte]) => buffer[xrefOffset + relative] !== byte)) {
    throw new Error("SetIsBorderRequired error context instructions changed");
  }
  // Rust's register allocation changed between the previous and current
  // Computer Use runtimes (`mov rsi, rax` -> `mov rbx, rax`).  The register
  // itself is not part of the compatibility patch; keep validating the
  // instruction shape while accepting both known encodings.
  if (![0xc3, 0xc6].includes(buffer[xrefOffset + 19])) {
    throw new Error("SetIsBorderRequired error context instructions changed");
  }
  return xrefOffset + 25;
}

function locateQueryResultPatch(buffer, xrefOffset) {
  const start = Math.max(0, xrefOffset - 320);
  const candidates = [];
  for (let offset = start; offset + 13 < xrefOffset; offset++) {
    if (
      matchesBytes(buffer, offset, [0xff, 0x10, 0x89, 0xc1, 0xe8]) &&
      matchesBytes(buffer, offset + 9, [0x85, 0xd2, 0x74])
    ) {
      candidates.push(offset);
    }
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one optional border QI result sequence, found ${candidates.length}`);
  }
  const queryCallOffset = candidates[0];
  const patchOffset = queryCallOffset + 2;
  const continuationOffset = queryCallOffset + 9;
  return { continuationOffset, patchOffset };
}

function buildCompatibilityCave({ caveRva, continuationRva, hresultTargetRva, skipRva }) {
  const code = Buffer.from([
    0x3d,
    E_NOINTERFACE & 0xff,
    (E_NOINTERFACE >>> 8) & 0xff,
    (E_NOINTERFACE >>> 16) & 0xff,
    (E_NOINTERFACE >>> 24) & 0xff, // cmp eax, E_NOINTERFACE
    0x0f,
    0x84,
    0x0c,
    0x00,
    0x00,
    0x00, // je skip
    0x89,
    0xc1, // mov ecx, eax
    0xe8,
    0x00,
    0x00,
    0x00,
    0x00, // call HRESULT::ok
    0xe9,
    0x00,
    0x00,
    0x00,
    0x00, // jmp original continuation
    0xe9,
    0x00,
    0x00,
    0x00,
    0x00, // skip: jmp after optional border property
  ]);
  writeRelative32(code, 13, 5, hresultTargetRva, caveRva + 13);
  writeRelative32(code, 18, 5, continuationRva, caveRva + 18);
  writeRelative32(code, 23, 5, skipRva, caveRva + 23);
  return code;
}

function locateExistingPatch(buffer, sections, text, xrefOffset, skipRva) {
  const start = Math.max(text.rawOffset, xrefOffset - 320);
  const candidates = [];
  for (let offset = start; offset + 7 < xrefOffset; offset++) {
    if (
      buffer[offset] !== 0xe9 ||
      !matchesBytes(buffer, offset + 5, [0x90, 0x90])
    ) {
      continue;
    }
    const instructionRva = fileOffsetToRva(sections, offset);
    const caveRva = instructionRva + 5 + buffer.readInt32LE(offset + 1);
    const caveOffset = text.rawOffset + caveRva - text.virtualAddress;
    if (
      caveOffset < text.rawOffset ||
      caveOffset + 28 > text.rawOffset + text.rawSize ||
      buffer[caveOffset] !== 0x3d ||
      buffer.readUInt32LE(caveOffset + 1) !== E_NOINTERFACE ||
      !matchesBytes(buffer, caveOffset + 5, [0x0f, 0x84, 0x0c, 0x00, 0x00, 0x00])
    ) {
      continue;
    }
    const finalJumpRva = caveRva + 23;
    const finalTargetRva = finalJumpRva + 5 + buffer.readInt32LE(caveOffset + 24);
    if (finalTargetRva === skipRva) candidates.push({ caveOffset, offset });
  }
  if (candidates.length > 1) {
    throw new Error(`Found ${candidates.length} Computer Use compatibility patches`);
  }
  return candidates[0] ?? null;
}

function patchComputerUseBuffer(input) {
  const buffer = Buffer.from(input);
  const { sections, text } = readPeLayout(buffer);
  const markerOffsets = findAll(buffer, ERROR_MARKER);
  if (markerOffsets.length !== 1) {
    throw new Error(`Expected one SetIsBorderRequired marker, found ${markerOffsets.length}`);
  }
  const markerRva = fileOffsetToRva(sections, markerOffsets[0]);
  const xrefOffset = locateBorderErrorXref(buffer, sections, text, markerRva);
  const skipOffset = validateErrorContextTrailer(buffer, xrefOffset);
  const skipRva = fileOffsetToRva(sections, skipOffset);

  const existing = locateExistingPatch(buffer, sections, text, xrefOffset, skipRva);
  if (existing) {
    return { buffer, caveOffset: existing.caveOffset, patchOffset: existing.offset, status: "already-patched" };
  }

  const { continuationOffset, patchOffset } = locateQueryResultPatch(buffer, xrefOffset);
  const original = buffer.subarray(patchOffset, patchOffset + 7);
  if (original[0] !== 0x89 || original[1] !== 0xc1 || original[2] !== 0xe8) {
    throw new Error("Optional border QI conversion instructions changed");
  }

  const caveRelativeOffset = align(text.virtualSize, 16);
  const caveOffset = text.rawOffset + caveRelativeOffset;
  const caveRva = text.virtualAddress + caveRelativeOffset;
  const continuationRva = fileOffsetToRva(sections, continuationOffset);
  const hresultCallRva = fileOffsetToRva(sections, patchOffset + 2);
  const hresultTargetRva = hresultCallRva + 5 + buffer.readInt32LE(patchOffset + 3);
  const code = buildCompatibilityCave({
    caveRva,
    continuationRva,
    hresultTargetRva,
    skipRva,
  });
  if (caveRelativeOffset + code.length > text.rawSize) {
    throw new Error("Computer Use helper has no executable padding for compatibility code");
  }
  const padding = buffer.subarray(caveOffset, caveOffset + code.length);
  if (padding.some((byte) => byte !== 0)) {
    throw new Error("Computer Use helper executable padding is not empty");
  }

  code.copy(buffer, caveOffset);
  const patchRva = fileOffsetToRva(sections, patchOffset);
  const jump = Buffer.from([0xe9, 0, 0, 0, 0, 0x90, 0x90]);
  writeRelative32(jump, 0, 5, caveRva, patchRva);
  jump.copy(buffer, patchOffset);
  buffer.writeUInt32LE(caveRelativeOffset + code.length, text.headerOffset + 8);

  return { buffer, caveOffset, patchOffset, status: "patched" };
}

function parseTarget(args) {
  const targetIndex = args.indexOf("--target");
  if (targetIndex === -1) return DEFAULT_TARGET;
  const target = args[targetIndex + 1];
  if (!target) throw new Error("--target requires a path");
  return path.resolve(target);
}

function main() {
  const args = process.argv.slice(2);
  const platform = args.find((arg) => ["mac-arm64", "mac-x64", "win", "unix"].includes(arg));
  if (platform && platform !== "win") {
    console.log("  [ok] Computer Use Windows 10 compatibility only applies to Windows");
    return;
  }

  const target = parseTarget(args);
  if (!fs.existsSync(target)) {
    if (platform === "win") throw new Error(`Computer Use helper is missing: ${target}`);
    console.log(`  [ok] No Windows Computer Use helper found at ${relPath(target)}`);
    return;
  }

  const source = fs.readFileSync(target);
  const result = patchComputerUseBuffer(source);
  if (result.status === "already-patched") {
    console.log(`  [ok] ${relPath(target)}: Windows 10 screenshot compatibility already patched`);
    return;
  }
  if (args.includes("--check")) {
    console.log(`  [ok] ${relPath(target)}: Windows 10 screenshot compatibility patch is applicable`);
    return;
  }
  fs.writeFileSync(target, result.buffer);
  console.log(`  [ok] ${relPath(target)}: ignored E_NOINTERFACE for optional capture border API`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[x] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  E_NOINTERFACE,
  ERROR_MARKER,
  buildCompatibilityCave,
  patchComputerUseBuffer,
  readPeLayout,
};
