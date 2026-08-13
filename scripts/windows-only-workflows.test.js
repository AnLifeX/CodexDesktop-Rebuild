#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflows = ["build.yml", "sync.yml"].map((name) => ({
  name,
  text: fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", name),
    "utf8",
  ).replace(/\r\n/g, "\n"),
}));

test("default and scheduled build workflows are Windows-only", () => {
  for (const { name, text } of workflows) {
    assert.match(
      text,
      /concurrency:\n\s+group: codex-windows-release-state\n\s+cancel-in-progress: false/,
    );
    assert.match(text, /^  build-windows:\s*$/m, `${name} must build Windows`);
    assert.doesNotMatch(text, /^  build-mac:\s*$/m, `${name} must not contain a macOS build job`);
    assert.doesNotMatch(text, /macos-(?:latest|\d+)|build:mac|sync-upstream\.js --force --skip-win/);
  }
  const scheduled = workflows.find(({ name }) => name === "sync.yml").text;
  assert.match(
    scheduled,
    /node scripts\/check-update\.js --windows-only --json --force/,
  );
});

test("Windows releases use official+rN codex-win tags and ZIP-only public assets", () => {
  for (const { name, text } of workflows) {
    assert.match(
      text,
      /configure-windows-release-version\.js/,
    );
    assert.match(text, /--previous["', ]+scripts\/upstream-versions\.json/);
    assert.match(text, /--write-package["', ]+package\.json/);
    assert.match(text, /--write-package["', ]+src\/win\/_asar\/package\.json/);
    assert.match(text, /--github-output/);
    assert.match(text, /windows_internal_app_version/);
    assert.match(text, /windows_package_version/);
    assert.match(text, /tag_name: codex-win-/i, `${name} must use codex-win tags`);
    assert.match(text, /name: Codex Win /i, `${name} must use the Windows release title`);
    assert.match(text, /CodexSetup-win-x64-.*\.zip/);
    assert.match(
      text,
      /validate-windows-release-feed\.js --root out\/update-feed --version "\$\{\{ steps\.windows_artifacts\.outputs\.windows_package_version \}\}"/,
    );
    assert.match(text, /scripts\/windows-release-metadata\.js/);
    assert.match(text, /--write["', ]+out\/windows-release-metadata\.json/);
    assert.match(text, /windows-release-metadata\.json/);
    const release = text.match(/uses: softprops\/action-gh-release@v3[\s\S]*?(?=\n\s+- name: Prepare Windows update feed|\n\s+- name: Publish Windows update feed)/)?.[0] || "";
    assert.match(release, /Codex-win-x64-.*\.zip/);
    assert.match(release, /CodexSetup-win-x64-.*\.zip/);
    assert.doesNotMatch(release, /artifacts\/.*(?:\.exe|\.nupkg)|artifacts\/.*RELEASES/);
  }
});

test("Windows builds match and record the Codex CLI bundled by the official MSIX", () => {
  for (const { name, text } of workflows) {
    const syncIndex = text.indexOf("name: Sync upstream Windows package");
    const cliIndex = text.indexOf("name: Match official Codex CLI runtime");
    const patchIndex = text.indexOf("scripts/patch-all.js win");
    assert.ok(syncIndex !== -1 && syncIndex < cliIndex, `${name} must inspect the synced MSIX`);
    assert.ok(cliIndex < patchIndex, `${name} must install the matching CLI before patching`);
    assert.match(text, /configure-codex-cli-version\.js `\n\s+--binary src\/win\/codex\.exe/);
    assert.match(text, /--write-package package\.json `\n\s+--github-output/);
    assert.match(
      text,
      /npm install --ignore-scripts --no-audit --no-fund --save-optional --save-exact "@openai\/codex@\$codexCliVersion"/,
    );
    assert.match(text, /windows_codex_cli_version: \$\{\{ steps\.codex_cli\.outputs\.codex_cli_version \}\}/);
    assert.match(text, /--version "\$WINDOWS_CODEX_CLI_VERSION" \\\n\s+--write-package package\.json/);
    assert.match(
      text,
      /npm install --package-lock-only --ignore-scripts --no-audit --no-fund \\\n\s+--save-optional --save-exact "@openai\/codex@\$WINDOWS_CODEX_CLI_VERSION"/,
    );
    assert.match(text, /git add package\.json package-lock\.json scripts\/upstream-versions\.json/);
    assert.match(text, /Bundled Codex CLI:/);
  }
});

test("the manual workflow publishes Windows by default", () => {
  const workflow = workflows.find(({ name }) => name === "build.yml").text;
  assert.match(workflow, /publish_release:\s*\n(?:\s+.*\n)*?\s+default: true\s*\n\s+type: boolean/);
  assert.match(workflow, /publish_update_feed:\s*\n(?:\s+.*\n)*?\s+default: true\s*\n\s+type: boolean/);
  assert.doesNotMatch(workflow, /\n\s+platform:\s*\n/);
  assert.doesNotMatch(workflow, /^  publish-windows-update-feed:\s*$/m);
  assert.match(workflow, /name: Validate replacement inputs/);
  assert.ok(
    workflow.indexOf("name: Validate replacement inputs") < workflow.indexOf("uses: actions\/setup-node@v6"),
  );
});

test("scheduled sync publishes validated drafts while manual sync can leave drafts", () => {
  const workflow = workflows.find(({ name }) => name === "sync.yml").text;

  assert.match(
    workflow,
    /publish_release:\s*\n(?:\s+.*\n)*?\s+default: false/,
  );
  assert.match(workflow, /name: Upload Windows assets to draft release/);
  assert.match(workflow, /name: Upload Windows update feed to draft staging release/);
  assert.match(workflow, /draft: true/);
  assert.match(
    workflow,
    /if: needs\.check\.result == 'success' && needs\.check\.outputs\.windows_changed == 'true' && needs\.build-windows\.result == 'success' && \(github\.event_name == 'schedule' \|\| inputs\.publish_release == true\)/,
  );
  assert.match(
    workflow,
    /- name: Record built Windows versions\n\s+if: github\.event_name == 'schedule' \|\| inputs\.publish_release == true/,
  );
  assert.doesNotMatch(workflow, /Prepare Windows update feed\n/);
  assert.doesNotMatch(workflow, /actions\/(?:upload|download)-artifact/);
});

test("Windows builds hand off through draft releases instead of Actions artifacts", () => {
  for (const { name, text } of workflows) {
    assert.doesNotMatch(text, /actions\/upload-artifact|actions\/download-artifact/, "${name} must not use Actions artifacts");
    assert.match(text, /name: Upload Windows assets to draft release/);
    assert.match(text, /name: Upload Windows update feed to draft staging release/);
    assert.match(text, /tag_name: windows-update-feed-staging-/);
    assert.match(text, /draft: true/);
  }
});

test("release jobs resolve Squirrel package versions from the update-feed directory", () => {
  for (const { name, text } of workflows) {
    assert.match(text, /resolve-release-artifacts\.js --root artifacts --github-output/);
    assert.match(text, /resolve-release-artifacts\.js --root update-feed --github-output/);
    assert.match(
      text,
      /PACKAGE_VERSION: \$\{\{ steps\.package_artifacts\.outputs\.windows_package_version \}\}/,
    );
  }
});

test("manual and scheduled releases reject mutable or rollback feed state before committing", () => {
  for (const { name, text } of workflows) {
    const validateIndex = text.indexOf("name: Validate release metadata and monotonic state");
    const recordIndex = text.indexOf("name: Record built Windows versions");
    const releaseIndex = text.indexOf("name: Validate exact draft asset set");
    assert.ok(validateIndex !== -1, `${name} must validate remote release state`);
    assert.ok(validateIndex < recordIndex && recordIndex < releaseIndex);
    assert.match(text, /windows-release-metadata\.js \\\n\s+--metadata "\$metadata_file" \\\n\s+--validate-promotion/);
    assert.match(text, /--remote-releases "\$remote_releases"/);
    assert.match(text, /404\) : > "\$remote_releases"/);
  }
});
