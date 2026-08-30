#!/usr/bin/env node

const MANAGED_TAG = /^(?:codex-win|windows-update-feed-staging)-\d+\.\d+\.\d+(?:-r[1-9]\d*)?$/;
const RUN_MARKER = /<!--\s*codex-rebuild-run-id:(\d+)\s*-->/;
const DAY_MS = 24 * 60 * 60 * 1000;

function valueAfter(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return "";
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function extractSourceRunId(release) {
  return String(release?.body || "").match(RUN_MARKER)?.[1] || null;
}

function isManagedWindowsDraft(release) {
  return release?.draft === true && MANAGED_TAG.test(String(release.tag_name || ""));
}

function ageInDays(release, now) {
  const created = new Date(release.created_at || "");
  if (Number.isNaN(created.getTime())) return -1;
  return (now.getTime() - created.getTime()) / DAY_MS;
}

function classifyRun(run) {
  if (!run) return "unknown";
  if (run.status !== "completed" || !run.conclusion) return "active";
  return run.conclusion === "success" ? "success" : "failed";
}

function shouldDeleteScheduledDraft(release, run, now = new Date()) {
  if (!isManagedWindowsDraft(release) || !extractSourceRunId(release)) return false;
  const age = ageInDays(release, now);
  if (age < 0) return false;
  const state = classifyRun(run);
  if (state === "active") return false;
  if (state === "failed") return age >= 1;
  return age >= 7;
}

class GitHubApi {
  constructor({ repository, token }) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "")) {
      throw new Error("GITHUB_REPOSITORY must be owner/repository");
    }
    if (!token) throw new Error("GH_TOKEN is required");
    this.repository = repository;
    this.headers = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    };
  }

  async request(path, options = {}) {
    const response = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: { ...this.headers, ...options.headers },
    });
    if (response.status === 404 && options.allowNotFound) return null;
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API ${options.method || "GET"} ${path} failed (${response.status}): ${body}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async listDrafts() {
    const drafts = [];
    for (let page = 1; ; page += 1) {
      const releases = await this.request(
        `/repos/${this.repository}/releases?per_page=100&page=${page}`,
      );
      drafts.push(...releases.filter(isManagedWindowsDraft));
      if (releases.length < 100) break;
    }
    return drafts;
  }

  getRun(runId) {
    return this.request(`/repos/${this.repository}/actions/runs/${runId}`, { allowNotFound: true });
  }

  deleteRelease(releaseId) {
    if (!Number.isInteger(releaseId) || releaseId <= 0) throw new Error("Invalid release id");
    return this.request(`/repos/${this.repository}/releases/${releaseId}`, { method: "DELETE" });
  }
}

async function planScheduledCleanup(api, drafts, now = new Date()) {
  const runCache = new Map();
  const planned = [];
  for (const release of drafts) {
    const runId = extractSourceRunId(release);
    if (!runId) continue;
    if (!runCache.has(runId)) runCache.set(runId, api.getRun(runId));
    const run = await runCache.get(runId);
    if (shouldDeleteScheduledDraft(release, run, now)) {
      planned.push({ release, runId, state: classifyRun(run) });
    }
  }
  return planned;
}

async function main() {
  const args = process.argv.slice(2);
  const scheduled = args.includes("--scheduled");
  const sourceRunId = valueAfter(args, "--run-id");
  const doDelete = args.includes("--delete");
  if (scheduled === Boolean(sourceRunId)) {
    throw new Error("Choose exactly one of --scheduled or --run-id <id>");
  }
  if (sourceRunId && !/^\d+$/.test(sourceRunId)) throw new Error("--run-id must contain digits only");

  const api = new GitHubApi({
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GH_TOKEN,
  });
  const drafts = await api.listDrafts();
  const planned = scheduled
    ? await planScheduledCleanup(api, drafts)
    : drafts
      .filter((release) => extractSourceRunId(release) === sourceRunId)
      .map((release) => ({ release, runId: sourceRunId, state: "current-failed-run" }));

  if (planned.length === 0) {
    console.log("No managed Windows drafts are eligible for cleanup.");
    return;
  }
  for (const { release, runId, state } of planned) {
    console.log(`${doDelete ? "Deleting" : "Would delete"} draft ${release.tag_name} (release ${release.id}, run ${runId}, state ${state}).`);
    if (doDelete) await api.deleteRelease(release.id);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  classifyRun,
  extractSourceRunId,
  isManagedWindowsDraft,
  planScheduledCleanup,
  shouldDeleteScheduledDraft,
};
