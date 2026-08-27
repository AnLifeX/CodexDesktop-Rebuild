#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  E_NOINTERFACE,
  ERROR_MARKER,
  patchComputerUseBuffer,
  readPeLayout,
} = require("./patch-computer-use-win10");

function writeSectionHeader(buffer, offset, { name, virtualSize, virtualAddress, rawSize, rawOffset }) {
  buffer.write(name, offset, 8, "ascii");
  buffer.writeUInt32LE(virtualSize, offset + 8);
  buffer.writeUInt32LE(virtualAddress, offset + 12);
  buffer.writeUInt32LE(rawSize, offset + 16);
  buffer.writeUInt32LE(rawOffset, offset + 20);
  buffer.writeUInt32LE(0x60000020, offset + 36);
}

function writeRel32(buffer, instructionOffset, instructionRva, targetRva) {
  buffer.writeInt32LE(targetRva - (instructionRva + 5), instructionOffset + 1);
}

function createFixture({
  duplicateMarker = false,
  corruptQuery = false,
  contextRegister = 0xc6,
  directContext = false,
  adjacentQuery = false,
} = {}) {
  const buffer = Buffer.alloc(0xc00);
  buffer.write("MZ", 0, "ascii");
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write("PE\0\0", 0x80, "ascii");
  const coff = 0x84;
  buffer.writeUInt16LE(0x8664, coff);
  buffer.writeUInt16LE(2, coff + 2);
  buffer.writeUInt16LE(0xf0, coff + 16);
  const optional = coff + 20;
  buffer.writeUInt16LE(0x20b, optional);
  const sectionTable = optional + 0xf0;
  writeSectionHeader(buffer, sectionTable, {
    name: ".text",
    virtualSize: 0x300,
    virtualAddress: 0x1000,
    rawSize: 0x400,
    rawOffset: 0x400,
  });
  writeSectionHeader(buffer, sectionTable + 40, {
    name: ".rdata",
    virtualSize: 0x200,
    virtualAddress: 0x2000,
    rawSize: 0x200,
    rawOffset: 0x800,
  });

  const markerOffset = 0x850;
  ERROR_MARKER.copy(buffer, markerOffset);
  if (duplicateMarker) ERROR_MARKER.copy(buffer, 0x890);
  const markerRva = 0x2050;

  const queryOffset = 0x480;
  const borderIidOffset = 0x8c0;
  Buffer.from("66d9cdf2ae22a15e95963a289344c3be", "hex").copy(
    buffer,
    borderIidOffset,
  );
  Buffer.from([0x48, 0x8d, 0x15, 0, 0, 0, 0, 0x4c, 0x8d, 0x44, 0x24, 0x60]).copy(
    buffer,
    queryOffset - 12,
  );
  buffer.writeInt32LE(0x20c0 - (0x1074 + 7), queryOffset - 9);
  Buffer.from([
    0xff,
    0x10,
    0x89,
    0xc1,
    0xe8,
    0,
    0,
    0,
    0,
    0x85,
    0xd2,
    0x74,
    0x24,
    0x48,
    0x89,
    0xc6,
    0x89,
    0xd3,
    0xeb,
    0x4f,
  ]).copy(buffer, queryOffset);
  if (corruptQuery) buffer[queryOffset + 9] = 0x84;
  const queryCallOffset = queryOffset + 4;
  writeRel32(buffer, queryCallOffset, 0x1084, 0x1180);
  if (adjacentQuery) {
    const adjacentOffset = 0x4c0;
    Buffer.from("40ae392c2e7d4450804e8b6799d4cf9e", "hex").copy(buffer, 0x8d0);
    Buffer.from([0x48, 0x8d, 0x15, 0, 0, 0, 0, 0x4c, 0x8d, 0x44, 0x24, 0x60]).copy(
      buffer,
      adjacentOffset - 12,
    );
    buffer.writeInt32LE(0x20d0 - (0x10b4 + 7), adjacentOffset - 9);
    Buffer.from([
      0xff,
      0x10,
      0x89,
      0xc1,
      0xe8,
      0,
      0,
      0,
      0,
      0x85,
      0xd2,
      0x74,
      0x24,
    ]).copy(buffer, adjacentOffset);
    writeRel32(buffer, adjacentOffset + 4, 0x10c4, 0x1180);
  }

  const xrefOffset = 0x520;
  if (directContext) {
    Buffer.from([
      0x41,
      0xb9,
      ERROR_MARKER.length,
      0,
      0,
      0,
      0x48,
      0x89,
      0xf1,
      0x44,
      0x89,
      0xf2,
    ]).copy(buffer, xrefOffset - 12);
  }
  Buffer.from([0x4c, 0x8d, 0x05, 0, 0, 0, 0]).copy(buffer, xrefOffset);
  buffer.writeInt32LE(markerRva - (0x1120 + 7), xrefOffset + 3);
  const trailer = directContext
    ? [
        0xe8,
        0,
        0,
        0,
        0,
        0x49,
        0x89,
        0xc6,
        0x48,
        0x85,
        0xc0,
        0x75,
        0x2e,
      ]
    : [
        0x6a,
        ERROR_MARKER.length,
        0x41,
        0x59,
        0xe8,
        0,
        0,
        0,
        0,
        0x90,
        0x48,
        0x89,
        contextRegister,
        0x48,
        0x85,
        0xc0,
        0x75,
        0x3e,
      ];
  Buffer.from(trailer).copy(buffer, xrefOffset + 7);
  return buffer;
}

function relativeTarget(buffer, instructionOffset, instructionRva) {
  return instructionRva + 5 + buffer.readInt32LE(instructionOffset + 1);
}

test("patches only the optional border-interface E_NOINTERFACE path", () => {
  const source = createFixture();
  const original = Buffer.from(source);
  const result = patchComputerUseBuffer(source);
  assert.equal(result.status, "patched");
  assert.deepEqual(source, original, "patcher must not mutate its input buffer");

  const { text } = readPeLayout(result.buffer);
  assert.equal(result.patchOffset, 0x482);
  assert.deepEqual([...result.buffer.subarray(0x487, 0x489)], [0x90, 0x90]);
  const caveRva = relativeTarget(result.buffer, result.patchOffset, 0x1082);
  assert.equal(caveRva, 0x1300);
  assert.equal(result.caveOffset, 0x700);
  assert.equal(result.buffer.readUInt32LE(result.caveOffset + 1), E_NOINTERFACE);
  assert.deepEqual(
    [...result.buffer.subarray(result.caveOffset + 5, result.caveOffset + 11)],
    [0x0f, 0x84, 0x0c, 0x00, 0x00, 0x00],
    "only E_NOINTERFACE should branch to the compatibility skip",
  );
  assert.equal(text.virtualSize, 0x31c);

  const second = patchComputerUseBuffer(result.buffer);
  assert.equal(second.status, "already-patched");
  assert.deepEqual(second.buffer, result.buffer);
});

test("accepts the current runtime's alternate error-context register allocation", () => {
  const result = patchComputerUseBuffer(createFixture({ contextRegister: 0xc3 }));
  assert.equal(result.status, "patched");
});

test("accepts the latest runtime's preloaded marker-length context", () => {
  const result = patchComputerUseBuffer(createFixture({
    directContext: true,
    adjacentQuery: true,
  }));
  assert.equal(result.status, "patched");
  assert.equal(result.patchOffset, 0x482);

  const second = patchComputerUseBuffer(result.buffer);
  assert.equal(second.status, "already-patched");
});

test("fails closed when the helper markers or QI instructions change", () => {
  assert.throws(
    () => patchComputerUseBuffer(createFixture({ duplicateMarker: true })),
    /Expected one SetIsBorderRequired marker, found 2/,
  );
  assert.throws(
    () => patchComputerUseBuffer(createFixture({ corruptQuery: true })),
    /Expected one optional border QI result sequence, found 0/,
  );
  assert.throws(
    () => patchComputerUseBuffer(createFixture({ contextRegister: 0xc7 })),
    /SetIsBorderRequired error context instructions changed/,
  );
});

test("runs the Computer Use compatibility patch in the standard patch pipeline", () => {
  const patchAll = fs.readFileSync(path.join(__dirname, "patch-all.js"), "utf8");
  assert.match(patchAll, /"patch-computer-use-win10\.js"/);
  assert.ok(
    patchAll.indexOf('"patch-computer-use-win10.js"') <
      patchAll.indexOf('"patch-updater.js"'),
    "native helper compatibility must be patched before updater bundle patches",
  );
});
