#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflowPath = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "promote-windows-release.yml",
);

function readWorkflow() {
  assert.ok(fs.existsSync(workflowPath), "Windows release promotion workflow should exist");
  return fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
}

function collectRunCommands(workflow) {
  const lines = workflow.split("\n");
  const commands = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)run:\s*(.*)$/);
    if (!match) continue;
    if (match[2] !== "|") {
      commands.push(match[2]);
      continue;
    }
    const indent = match[1].length;
    const block = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() && line.match(/^\s*/)[0].length <= indent) {
        index -= 1;
        break;
      }
      block.push(line);
    }
    commands.push(block.join("\n"));
  }
  return commands;
}

test("promotion workflow validates dispatch inputs before every external action", () => {
  const workflow = readWorkflow();
  const firstStep = workflow.match(
    /    steps:\n      - name: Validate promotion inputs\n(?<body>[\s\S]*?)(?=\n      - name:)/,
  )?.groups.body;
  assert.ok(firstStep, "input validation should be the first workflow step");
  assert.match(firstStep, /RELEASE_VERSION: \$\{\{ inputs\.release_version \}\}/);
  assert.match(firstStep, /SOURCE_RUN_ID: \$\{\{ inputs\.source_run_id \}\}/);
  assert.match(firstStep, /set -euo pipefail/);
  assert.ok(firstStep.includes('[[ ! "$RELEASE_VERSION" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+(-r[1-9][0-9]*)?$ ]]'));
  assert.ok(firstStep.includes('[[ ! "$SOURCE_RUN_ID" =~ ^[0-9]+$ ]]'));

  for (const command of collectRunCommands(workflow)) {
    assert.doesNotMatch(
      command,
      /\$\{\{ inputs\.(?:release_version|source_run_id) \}\}/,
      "run commands must receive dispatch inputs through env",
    );
  }
});

test("promotion workflow downloads exact draft Release assets and verifies source run", () => {
  const workflow = readWorkflow();

  assert.match(workflow, /source_run_id:\n\s+description:.*\n\s+required: true\n\s+type: string/);
  assert.match(workflow, /release_version:\n\s+description:.*\n\s+required: true\n\s+type: string/);
  assert.match(workflow, /permissions:\n\s+actions: read\n\s+contents: write/);
  assert.match(workflow, /uses: actions\/checkout@v\d+/);

  assert.doesNotMatch(workflow, /actions\/download-artifact@v7/);
  assert.match(workflow, /gh release download "\$release_tag"/);
  assert.match(workflow, /--pattern "CodexSetup-win-x64-\$RELEASE_VERSION\.zip"/);
  assert.match(workflow, /--pattern "Codex-win-x64-\$RELEASE_VERSION\.zip"/);
  assert.match(workflow, /--pattern "windows-release-metadata\.json"/);
  assert.match(workflow, /--pattern '\*\.nupkg'/);
  assert.match(workflow, /--pattern 'RELEASES'/);
  assert.match(workflow, /test "\$\(jq -r '\.isDraft' <<<"\$release_json"\)" = true/);
  assert.match(workflow, /actions\/runs\/\$SOURCE_RUN_ID/);
  assert.match(workflow, /test "\$\(jq -r '\.path' <<<"\$run_json"\)" = "\.github\/workflows\/build\.yml"/);
  assert.doesNotMatch(workflow, /Codex-mac|\.dmg|build-mac/i);
});

test("promotion workflow validates installer portable and full package versions", () => {
  const workflow = readWorkflow();

  assert.match(workflow, /resolve-release-artifacts\.js --root artifacts\/installer --github-output/);
  assert.match(workflow, /resolve-release-artifacts\.js --root artifacts\/portable --github-output/);
  assert.match(workflow, /resolve-release-artifacts\.js --root artifacts\/update-feed --github-output/);
  assert.match(workflow, /steps\.installer_artifacts\.outputs\.windows_installer_version/);
  assert.match(workflow, /steps\.portable_artifacts\.outputs\.windows_portable_version/);
  assert.match(workflow, /steps\.package_artifacts\.outputs\.windows_package_version/);
  assert.match(workflow, /EXPECTED_VERSION: \$\{\{ inputs\.release_version \}\}/);
  assert.match(workflow, /INSTALLER_VERSION: \$\{\{ steps\.installer_artifacts\.outputs\.windows_installer_version \}\}/);
  assert.match(workflow, /PORTABLE_VERSION: \$\{\{ steps\.portable_artifacts\.outputs\.windows_portable_version \}\}/);
  assert.match(workflow, /PACKAGE_VERSION: \$\{\{ steps\.package_artifacts\.outputs\.windows_package_version \}\}/);
  assert.match(workflow, /\[ -z "\$actual" \] \|\| \[ "\$actual" != "\$EXPECTED_VERSION" \]/);
  assert.match(
    workflow,
    /validate-windows-release-feed\.js --root artifacts\/update-feed --version "\$PACKAGE_VERSION"/,
  );
  assert.match(workflow, /windows-release-metadata\.js/);
  assert.match(workflow, /--validate-promotion/);
  assert.match(workflow, /actions\/runs\/\$\{SOURCE_RUN_ID\}/);
  assert.match(workflow, /configure-windows-release-version\.js/);
  assert.match(workflow, /--internal-version "\$WINDOWS_INTERNAL_APP_VERSION"/);
});

test("promotion workflow publishes the validated Windows draft and feed staging assets", () => {
  const workflow = readWorkflow();

  assert.match(workflow, /release_tag="codex-win-\$RELEASE_VERSION"/);
  assert.match(workflow, /feed_staging_tag="windows-update-feed-staging-\$RELEASE_VERSION"/);
  assert.doesNotMatch(workflow, /tag_name:.*\|\||tag_name:.*mac/i);
  assert.match(workflow, /Windows draft/i);
  assert.match(workflow, /name: Validate exact draft release assets/);
  assert.match(workflow, /windows-release-metadata\.json/);
  assert.match(workflow, /gh release edit "\$RELEASE_TAG" --draft=false --latest/);
  assert.match(workflow, /gh release upload "\$tag" artifacts\/update-feed\/\*\.nupkg --clobber/);
  assert.match(workflow, /gh release upload "\$tag" artifacts\/update-feed\/RELEASES --clobber/);
  assert.match(workflow, /name: Remove Windows update feed staging draft/);
  assert.match(workflow, /releases\/tags\/\$FEED_STAGING_TAG" --jq '\.id'/);
  assert.match(workflow, /gh api --method DELETE "repos\/\$GITHUB_REPOSITORY\/releases\/\$staging_id"/);
  assert.doesNotMatch(workflow, /--cleanup-tag/);
});

test("promotion workflow reconciles exactly the portable and installer ZIP assets", () => {
  const workflow = readWorkflow();
  const step = workflow.match(
    /      - name: Reconcile exact release assets\n(?<body>[\s\S]*?)(?=\n      - name:|$)/,
  )?.groups.body;
  assert.ok(step, "release asset reconciliation step should exist after upload");
  assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(step, /gh release view "\$RELEASE_TAG" --json assets --jq '\.assets\[\]\.name'/);
  assert.match(step, /gh release delete-asset "\$RELEASE_TAG" "\$asset" -y/);
  assert.match(step, /sort > "\$actual_assets"/);
  assert.match(step, /cmp -s "\$desired_assets" "\$actual_assets"/);

  const expectedAssets = [
    "CodexSetup-win-x64-${RELEASE_VERSION}.zip",
    "Codex-win-x64-${RELEASE_VERSION}.zip",
  ];
  for (const asset of expectedAssets) assert.ok(step.includes(`"${asset}"`));
  assert.doesNotMatch(step, /\.dmg|\.nupkg|RELEASES|\.exe|delta_path/i);
});

test("promotion serializes release state and rejects rollback before publishing", () => {
  const workflow = readWorkflow();
  assert.match(
    workflow,
    /concurrency:\n\s+group: codex-windows-release-state\n\s+cancel-in-progress: false/,
  );
  const validationIndex = workflow.indexOf("name: Validate promotion metadata and monotonic state");
  const recordIndex = workflow.indexOf("name: Record promoted Windows versions");
  const releaseIndex = workflow.indexOf("name: Validate exact draft release assets");
  const feedIndex = workflow.indexOf("name: Publish Windows update feed");
  assert.ok(validationIndex < recordIndex && recordIndex < releaseIndex && releaseIndex < feedIndex);
  assert.match(workflow, /remote-releases "\$remote_releases"/);
  assert.match(workflow, /gh release edit "\$RELEASE_TAG" --draft=false --latest/);
});
