#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");
const test = require("node:test");
const ResEdit = require("resedit");
const {
  findCachedWindowsMsix,
  getPreparedWindowsMsixVersion,
  resolveWindowsMsixVersionFromManifest,
} = require("./windows-app-entry");

const source = fs.readFileSync(path.join(__dirname, "build-win-installer.js"), "utf-8");
const tempAssignmentIndex = source.indexOf("process.env.TEMP = shortTemp");
const winstallerRequireIndex = source.search(/require\(["']electron-winstaller["']\)/);

assert.ok(tempAssignmentIndex !== -1, "build-win-installer should configure a short TEMP path");
assert.ok(winstallerRequireIndex !== -1, "build-win-installer should load electron-winstaller");
assert.ok(
  winstallerRequireIndex > tempAssignmentIndex,
  "electron-winstaller must be required after TEMP/TMP/TMPDIR are set so it uses the short Squirrel temp path",
);
assert.match(
  source,
  /packageJson\.codexRebuildPackageVersion \|\| packageJson\.version/,
  "Squirrel must prefer the zero-padded internal package version over the public rN version",
);

function loadInstallerInternals() {
  const filename = path.join(__dirname, "build-win-installer.js");
  const isolatedSource = source.replace(
    /main\(\)\.catch\(\(error\) => \{[\s\S]*?\n\}\);\s*$/,
    "module.exports = { createLegacyExecutableAlias, markSquirrelAware, resolvePrimaryExecutableNameFromManifest, resolveSquirrelReleaseOptions };\n",
  );
  const module = { exports: {} };
  vm.runInNewContext(isolatedSource, {
    Buffer,
    __dirname,
    console,
    module,
    process,
    require: createRequire(filename),
  }, { filename });
  return module.exports;
}

test("resolves the official primary executable from current and legacy Appx manifests", () => {
  const { resolvePrimaryExecutableNameFromManifest } = loadInstallerInternals();
  const current = `<?xml version="1.0"?><Package><Applications><Application
    Id="App" Executable="app/ChatGPT.exe" EntryPoint="Windows.FullTrustApplication" />
  </Applications></Package>`;
  const legacy = `<?xml version="1.0"?><Package><Applications><Application
    Id="App" Executable="app\\Codex.exe" EntryPoint="Windows.FullTrustApplication" />
  </Applications></Package>`;

  assert.equal(resolvePrimaryExecutableNameFromManifest(current), "ChatGPT.exe");
  assert.equal(resolvePrimaryExecutableNameFromManifest(legacy), "Codex.exe");
});

test("rejects Appx primary executables outside the app directory", () => {
  const { resolvePrimaryExecutableNameFromManifest } = loadInstallerInternals();
  assert.throws(
    () => resolvePrimaryExecutableNameFromManifest(
      `<Package><Applications><Application Executable="tools/ChatGPT.exe" /></Applications></Package>`,
    ),
    /primary executable.*app/i,
  );
});

test("resolves the exact freshly synced Windows MSIX identity version", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-msix-manifest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifestDir = path.join(root, "win-extract");
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifest =
    `<Package><Identity Name="OpenAI.Codex" Version="26.707.8479.0" />` +
    `<Applications /></Package>`;
  fs.writeFileSync(path.join(manifestDir, "AppxManifest.xml"), manifest);

  assert.equal(resolveWindowsMsixVersionFromManifest(manifest), "26.707.8479.0");
  assert.equal(getPreparedWindowsMsixVersion([root]), "26.707.8479.0");
});

test("rejects malformed or conflicting freshly synced Windows versions", (t) => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), "codex-msix-manifest-first-"));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), "codex-msix-manifest-second-"));
  t.after(() => {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  });
  for (const [root, version] of [
    [first, "26.707.8479.0"],
    [second, "26.707.8480.0"],
  ]) {
    const dir = path.join(root, "win-extract");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "AppxManifest.xml"),
      `<Package><Identity Version="${version}" /></Package>`,
    );
  }

  assert.throws(
    () => resolveWindowsMsixVersionFromManifest(
      `<Package><Identity Version="26.707.bad.0" /></Package>`,
    ),
    /valid package identity version/i,
  );
  assert.throws(
    () => getPreparedWindowsMsixVersion([first, second]),
    /manifests disagree.*26\.707\.8479\.0.*26\.707\.8480\.0/i,
  );
});

test("selects the expected cached Windows MSIX regardless of mtime", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-msix-cache-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const older = path.join(root, "OpenAI.Codex_26.623.1.0_x64__test.msix");
  const newer = path.join(root, "OpenAI.Codex_26.707.1.0_x64__test.msix");
  fs.writeFileSync(older, "old");
  fs.writeFileSync(newer, "new");
  fs.utimesSync(older, new Date(2_000), new Date(2_000));
  fs.utimesSync(newer, new Date(1_000), new Date(1_000));
  assert.equal(findCachedWindowsMsix([root], "26.707.1.0"), newer);
});

test("fails closed when the expected Windows MSIX is absent or ambiguous", (t) => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), "codex-msix-first-"));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), "codex-msix-second-"));
  t.after(() => {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(first, "OpenAI.Codex_26.623.1.0_x64__test.msix"), "old");
  assert.throws(
    () => findCachedWindowsMsix([first], "26.707.1.0"),
    /expected Windows x64 MSIX.*26\.707\.1\.0.*not found/i,
  );

  const expectedName = "OpenAI.Codex_26.707.1.0_x64__test.msix";
  fs.writeFileSync(path.join(first, expectedName), "first");
  fs.writeFileSync(path.join(second, expectedName), "second");
  assert.throws(
    () => findCachedWindowsMsix([first, second], "26.707.1.0"),
    /multiple Windows x64 MSIX.*26\.707\.1\.0/i,
  );
});

test("resolveSquirrelReleaseOptions uses remote releases for delta builds", () => {
  const { resolveSquirrelReleaseOptions } = loadInstallerInternals();
  assert.deepEqual(resolveSquirrelReleaseOptions({
    CODEX_REBUILD_REMOTE_RELEASES: "https://example.test/feed",
  }), {
    noDelta: false,
    remoteReleases: "https://example.test/feed",
  });
});

test("resolveSquirrelReleaseOptions disables remote releases for full-only builds", () => {
  const { resolveSquirrelReleaseOptions } = loadInstallerInternals();
  assert.deepEqual(resolveSquirrelReleaseOptions({
    CODEX_REBUILD_NO_DELTA: "1",
    CODEX_REBUILD_REMOTE_RELEASES: "https://example.test/feed",
  }), {
    noDelta: true,
    remoteReleases: undefined,
  });
});

test("resolveSquirrelReleaseOptions rejects invalid no-delta values", () => {
  const { resolveSquirrelReleaseOptions } = loadInstallerInternals();
  assert.throws(
    () => resolveSquirrelReleaseOptions({ CODEX_REBUILD_NO_DELTA: "true" }),
    /CODEX_REBUILD_NO_DELTA.*expected 1/,
  );
});

function namedWorkflowStep(workflow, name) {
  const normalized = workflow.replace(/\r\n/g, "\n");
  return normalized.match(
    new RegExp(`      - name: ${name}\\n(?<body>[\\s\\S]*?)(?=\\n      - (?:name:|uses:)|$)`),
  )?.groups.body;
}

function assertRequiredDeltaWindowsInstallerWorkflow(workflow, { supportsSkip }) {
  const configure = namedWorkflowStep(workflow, "Configure Windows update feed");
  const fullOnly = namedWorkflowStep(workflow, "Build full-only Windows installer");
  const delta = namedWorkflowStep(workflow, "Build Windows installer with required delta");
  const verify = namedWorkflowStep(workflow, "Verify required Windows delta package");

  assert.ok(configure, "Windows update feed configuration step should exist");
  assert.match(configure, /CODEX_REBUILD_UPDATE_URL=\$feed/);
  assert.match(configure, /CODEX_REBUILD_REMOTE_RELEASES=\$feed/);
  assert.doesNotMatch(configure, /CODEX_REBUILD_NO_DELTA/);

  if (supportsSkip) {
    assert.ok(fullOnly, "manual workflow should support an explicit full-only build");
    assert.match(fullOnly, /if: inputs\.skip_windows_delta == true/);
    assert.match(fullOnly, /timeout-minutes: 30/);
    assert.match(fullOnly, /CODEX_REBUILD_NO_DELTA: "1"/);
    assert.match(fullOnly, /npm run build:win-installer/);
  } else {
    assert.equal(fullOnly, undefined, "automatic releases must not silently build full-only");
  }

  assert.ok(delta, "required delta build step should exist");
  assert.match(delta, /id: windows_delta/);
  assert.doesNotMatch(delta, /continue-on-error/);
  assert.match(delta, /timeout-minutes: 60/);
  assert.match(delta, /npm run build:win-installer/);
  assert.doesNotMatch(delta, /CODEX_REBUILD_NO_DELTA/);
  if (supportsSkip) {
    assert.match(delta, /if: inputs\.skip_windows_delta != true/);
  } else {
    assert.doesNotMatch(delta, /skip_windows_delta/);
  }

  assert.ok(verify, "required delta output should be verified before publishing");
  assert.match(verify, /EXPECTED_VERSION: \$\{\{ steps\.windows_version\.outputs\.windows_package_version \}\}/);
  assert.match(verify, /-full\.nupkg/);
  assert.match(verify, /-delta\.nupkg/);
  assert.match(verify, /RELEASES does not reference required package/);
  if (supportsSkip) {
    assert.match(verify, /if: inputs\.skip_windows_delta != true/);
  } else {
    assert.doesNotMatch(verify, /skip_windows_delta/);
  }

  const deltaIndex = workflow.indexOf("name: Build Windows installer with required delta");
  const verifyIndex = workflow.indexOf("name: Verify required Windows delta package");
  const resolveIndex = workflow.indexOf("name: Resolve Windows artifact versions");
  assert.ok(deltaIndex < verifyIndex && verifyIndex < resolveIndex);
  assert.doesNotMatch(workflow, /Back up guaranteed full Windows installer|Finalize Windows installer output/);
}

test("Windows release workflows require delta output with a one-hour bound", () => {
  const buildWorkflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "build.yml"),
    "utf-8",
  ).replace(/\r\n/g, "\n");
  const syncWorkflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "sync.yml"),
    "utf-8",
  ).replace(/\r\n/g, "\n");

  assert.match(
    buildWorkflow,
    /skip_windows_delta:\s*\n(?:\s+.*\n)*?\s+default: false\s*\n\s+type: boolean/,
  );
  assertRequiredDeltaWindowsInstallerWorkflow(buildWorkflow, { supportsSkip: true });
  assertRequiredDeltaWindowsInstallerWorkflow(syncWorkflow, { supportsSkip: false });
});

test("manual delta test reuses artifacts without publishing and has a one-hour limit", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "windows-delta-test.yml"),
    "utf-8",
  ).replace(/\r\n/g, "\n");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /base_run_id:/);
  assert.match(workflow, /target_run_id:/);
  assert.match(workflow, /uses: actions\/download-artifact@v7/);
  assert.match(workflow, /run-id: \$\{\{ inputs\.base_run_id \}\}/);
  assert.match(workflow, /run-id: \$\{\{ inputs\.target_run_id \}\}/);
  const delta = namedWorkflowStep(workflow, "Generate delta package");
  assert.ok(delta, "delta-only workflow should have a bounded generation step");
  assert.match(delta, /continue-on-error: true/);
  assert.match(delta, /timeout-minutes: 60/);
  assert.match(delta, /SQUIRREL_EXE/);
  assert.match(delta, /--releasify/);
  assert.match(workflow, /targetRawName/);
  assert.match(workflow, /raw NuGet naming convention/);
  assert.match(workflow, /uses: actions\/upload-artifact@v7/);
  assert.match(workflow, /retention-days: 7/);
  assert.doesNotMatch(workflow, /gh release|softprops\/action-gh-release|WINDOWS_UPDATE_FEED/i);
});

test("manual Windows workflow can explicitly replace the same release version", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "build.yml"),
    "utf-8",
  ).replace(/\r\n/g, "\n");
  assert.match(
    workflow,
    /replace_existing_release:\s*\n(?:\s+.*\n)*?\s+default: false\s*\n\s+type: boolean/,
  );
  assert.match(
    workflow,
    /release_version_override:\s*\n(?:\s+.*\n)*?\s+default: ""\s*\n\s+type: string/,
  );
  assert.match(
    workflow,
    /rebuild_revision:\s*\n(?:\s+.*\n)*?\s+default: ""\s*\n\s+type: string/,
  );
  assert.match(workflow, /--release-version/);
  assert.match(workflow, /--rebuild-revision/);
  assert.match(workflow, /--allow-same-version-replacement/);
  assert.match(workflow, /replace_existing_release requires an exact release_version_override/);
  assert.match(workflow, /release_version_override is only allowed with replace_existing_release/);
  assert.match(workflow, /rebuild_revision must be a positive integer/);
  assert.match(workflow, /git ls-remote --exit-code --tags origin/);
  assert.match(workflow, /gh release view "\$tag"/);
  assert.match(workflow, /name: Retarget replacement release tag/);
  assert.match(workflow, /git push origin "refs\/tags\/\$tag" --force/);
  assert.match(workflow, /overwrite_files: true/);
  const validateAssetsIndex = workflow.indexOf("name: Validate exact Windows release assets");
  const publishFeedIndex = workflow.indexOf("name: Publish Windows update feed");
  const retargetIndex = workflow.indexOf("name: Retarget replacement release tag");
  assert.ok(validateAssetsIndex < publishFeedIndex && publishFeedIndex < retargetIndex);
});

function writePeWithoutVersionInfo(file) {
  const executable = ResEdit.NtExecutable.createEmpty(false, false);
  const resources = ResEdit.NtExecutableResource.from(executable);
  resources.entries.push({
    type: 24,
    id: 1,
    lang: 1033,
    codepage: 0,
    bin: Buffer.from("<assembly manifestVersion=\"1.0\"></assembly>", "utf8"),
  });
  resources.outputResource(executable);
  fs.writeFileSync(file, Buffer.from(executable.generate()));
}

function writePeWithVersionInfo(file) {
  const executable = ResEdit.NtExecutable.createEmpty(false, false);
  const resources = ResEdit.NtExecutableResource.from(executable);
  const version = ResEdit.Resource.VersionInfo.createEmpty();
  version.lang = 1033;
  version.setStringValues(
    { lang: 1033, codepage: 1200 },
    { CompanyName: "Preserve Me", SquirrelAwareVersion: "0" },
  );
  version.outputToResourceEntries(resources.entries);
  resources.outputResource(executable);
  fs.writeFileSync(file, Buffer.from(executable.generate()));
}

test("markSquirrelAware creates VERSIONINFO when the writable PE has none", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-squirrel-aware-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const exePath = path.join(root, "Codex.exe");
  writePeWithoutVersionInfo(exePath);

  const { markSquirrelAware } = loadInstallerInternals();
  markSquirrelAware(root, "Codex.exe");

  const executable = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(executable);
  const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  assert.equal(versions.length, 1);
  assert.equal(
    versions[0].getStringValues({ lang: 1033, codepage: 1200 }).SquirrelAwareVersion,
    "1",
  );
});

test("markSquirrelAware preserves existing VERSIONINFO strings", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-squirrel-aware-existing-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const exePath = path.join(root, "Codex.exe");
  writePeWithVersionInfo(exePath);

  const { markSquirrelAware } = loadInstallerInternals();
  markSquirrelAware(root, "Codex.exe");

  const executable = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(executable);
  const [version] = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  assert.deepEqual(
    version.getStringValues({ lang: 1033, codepage: 1200 }),
    { CompanyName: "Preserve Me", SquirrelAwareVersion: "1" },
  );
});

test("markSquirrelAware fails when the packaged executable is missing", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-squirrel-aware-missing-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { markSquirrelAware } = loadInstallerInternals();
  assert.throws(
    () => markSquirrelAware(root, "Codex.exe"),
    /packaged executable.*Codex\.exe.*not found/i,
  );
});

test("legacy Codex alias launches the primary binary without becoming Squirrel-aware", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-legacy-alias-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const primaryPath = path.join(root, "ChatGPT.exe");
  const legacyPath = path.join(root, "Codex.exe");
  writePeWithoutVersionInfo(primaryPath);
  fs.writeFileSync(legacyPath, "upstream trampoline");

  const { createLegacyExecutableAlias, markSquirrelAware } = loadInstallerInternals();
  createLegacyExecutableAlias(root, "ChatGPT.exe", "Codex.exe");
  assert.deepEqual(fs.readFileSync(legacyPath), fs.readFileSync(primaryPath));

  markSquirrelAware(root, "ChatGPT.exe");
  const readSquirrelAware = (file) => {
    const executable = ResEdit.NtExecutable.from(fs.readFileSync(file), { ignoreCert: true });
    const resources = ResEdit.NtExecutableResource.from(executable);
    const [version] = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
    return version?.getStringValues({ lang: 1033, codepage: 1200 }).SquirrelAwareVersion;
  };
  assert.equal(readSquirrelAware(primaryPath), "1");
  assert.equal(readSquirrelAware(legacyPath), undefined);
});
