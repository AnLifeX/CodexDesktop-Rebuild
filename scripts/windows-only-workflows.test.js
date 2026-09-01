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

test("workflows do not create or restore dependency caches", () => {
  const workflowDir = path.join(__dirname, "..", ".github", "workflows");
  for (const name of fs.readdirSync(workflowDir).filter((entry) => /\.ya?ml$/i.test(entry))) {
    const text = fs.readFileSync(path.join(workflowDir, name), "utf8");
    assert.doesNotMatch(text, /^\s*cache:\s*npm\s*$/m, `${name} must not enable setup-node caching`);
    assert.doesNotMatch(text, /uses:\s*actions\/cache@/i, `${name} must not use actions/cache`);
  }
});

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
    assert.match(text, /generate-windows-release-notes\.js/);
    assert.match(text, /--cli-version \$env:CLI_VERSION/);
  }
});

test("Windows releases use generated final-form notes with source run markers", () => {
  for (const { name, text } of workflows) {
    assert.match(text, /body_path: out\/windows-release-notes\.md/);
    assert.match(text, /--source-run-id "\$\{\{ github\.run_id \}\}"/);
    assert.match(text, /<!-- codex-rebuild-run-id:\$\{\{ github\.run_id \}\} -->/);
    assert.match(text, /codex-rebuild-run-id:\$\{GITHUB_RUN_ID\}/);
    assert.doesNotMatch(text, /remains a draft|仍是草稿/i, `${name} must not publish draft-only wording`);
  }
});

test("failed and expired Windows drafts are cleaned without touching active drafts", () => {
  for (const { name, text } of workflows) {
    assert.match(text, /^  cleanup-failed-drafts:\s*$/m, `${name} must clean failed runs`);
    assert.match(text, /always\(\).*needs\.build-windows\.result == 'failure'/);
    assert.match(
      text,
      /cleanup-windows-drafts\.js --run-id "\$\{\{ github\.run_id \}\}" --delete/,
    );
  }

  const scheduled = workflows.find(({ name }) => name === "sync.yml").text;
  assert.match(scheduled, /^  cleanup-stale-drafts:\s*$/m);
  assert.match(scheduled, /if: github\.event_name == 'schedule'/);
  assert.match(scheduled, /cleanup-windows-drafts\.js --scheduled --delete/);
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

test("scheduled and default manual sync publish validated drafts", () => {
  const workflow = workflows.find(({ name }) => name === "sync.yml").text;

  assert.match(
    workflow,
    /publish_release:\s*\n(?:\s+.*\n)*?\s+default: true/,
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

test("staging drafts are deleted by release id only after public release publication", () => {
  for (const { name, text } of workflows) {
    const publishIndex = text.indexOf("name: Publish Windows draft release");
    const replacementIndex = text.indexOf("name: Retarget replacement release tag");
    const cleanupIndex = text.indexOf("name: Remove Windows update feed staging draft");
    assert.ok(publishIndex !== -1, `${name} must publish the validated draft`);
    assert.ok(cleanupIndex > publishIndex, `${name} must clean staging after publication`);
    if (replacementIndex !== -1) {
      assert.ok(cleanupIndex > replacementIndex, `${name} must clean staging after retargeting`);
    }
    assert.match(
      text,
      /gh release view "\$FEED_STAGING_TAG" --json databaseId --jq '\.databaseId'/,
    );
    assert.match(
      text,
      /gh api --method DELETE "repos\/\$GITHUB_REPOSITORY\/releases\/\$staging_id"/,
    );
    assert.doesNotMatch(text, /--cleanup-tag/);
  }
});

test("draft release cleanup resolves ids through gh release view", () => {
  for (const { name, text } of workflows) {
    assert.match(
      text,
      /gh release view "\$RELEASE_TAG" --json databaseId --jq '\.databaseId'/,
      `${name} must resolve draft releases through the draft-aware CLI`,
    );
    assert.doesNotMatch(
      text,
      /releases\/tags\/\$(?:RELEASE_TAG|FEED_STAGING_TAG)/,
      `${name} must not query draft releases through the published-tag endpoint`,
    );
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

test("Windows update feeds carry forward and publish bounded delta-chain metadata", () => {
  for (const { name, text } of workflows) {
    assert.match(
      text,
      /curl\.exe --silent --show-error --location `[\s\S]*?\/delta-chain\.json\?build=/,
      `${name} must query the currently published delta chain before preparing the next feed`,
    );
    assert.match(
      text,
      /\$args \+= @\("--previous-manifest", \$previousManifest\)/,
      `${name} must carry the previous chain into feed preparation`,
    );
    assert.match(
      text,
      /--pattern 'delta-chain\.json'/,
      `${name} must preserve the manifest through the staging draft`,
    );
    assert.match(
      text,
      /printf 'delta-chain\.json\\n'/,
      `${name} must include the manifest in the exact stable-feed asset set`,
    );
    assert.match(
      text,
      /gh release upload "\$tag" "\$feed_dir\/delta-chain\.json" --clobber/,
      `${name} must publish the manifest atomically with RELEASES and packages`,
    );
  }
});
