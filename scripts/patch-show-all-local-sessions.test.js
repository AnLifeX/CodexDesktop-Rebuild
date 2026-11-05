#!/usr/bin/env node
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LOCAL_HOST_MARKER,
  ROOT_HOST_MARKER,
  patchProjectGroupSource,
} = require("./patch-show-all-local-sessions");

const SOURCE =
  "function group(e,u,c,l){let d=e.hostId==null||l(e.hostId)?c:e.hostId,p=u?.threadProjectAssignments?.[e.conversationId];return d+p}" +
  "function roots(n,t,a,l){let e=n.hostId==null||l(n.hostId)?t:n.hostId,r=n.cwd;if(!r||e!==t&&!a.has(e))continue;}";
const CURRENT_SOURCE =
  "function group(e,u,c,l){let d=e.hostId==null||l(e.hostId)?c:e.hostId,p=u?.threadProjectAssignments?.[e.conversationId];return d+p}" +
  "function roots(n,t,a,l){let e=n.hostId==null||l(n.hostId)?t:n.hostId;if(n.summary!=null&&!ok(n.cwd))continue;let r=n.cwd;if(!r||e!==t&&!a.has(e))continue;}";
const LATEST_SOURCE =
  "function group(e,u,c,l){let d=e.hostId==null||l(e.hostId)?c:e.hostId,p=u?.threadProjectAssignments?.[e.conversationId];return d+p}" +
  "function roots(n,t,a,l,u){let e=n.hostId==null||l(n.hostId)?t:n.hostId,p=u?.threadProjectAssignments?.[n.conversationId];if(n.summary!=null&&!ok(n.cwd))continue;let r=n.cwd;if(!r||e!==t&&!a.has(e))continue;}";

test("patches structural local-session targets and remains idempotent", () => {
  const first = patchProjectGroupSource(SOURCE);
  assert.equal(first.status, "patched");
  assert.ok(first.code.includes(LOCAL_HOST_MARKER));
  assert.ok(first.code.includes(ROOT_HOST_MARKER));
  assert.match(first.code, /enabledRemoteHostIds\?\.has\(e\.hostId\)/);
  assert.match(first.code, /remoteProjects\?\.some\(t=>t\.hostId===e\.hostId\)/);
  assert.match(first.code, /!a\.has\(n\.hostId\)/);
  const second = patchProjectGroupSource(first.code);
  assert.equal(second.status, "already");
  assert.equal(second.code, first.code);
});

test("fails closed when either structural role is missing or duplicated", () => {
  assert.throws(() => patchProjectGroupSource(SOURCE.split("function roots")[0]), /workspace root.*found 0/i);
  assert.throws(() => patchProjectGroupSource(`${SOURCE}${SOURCE}`), /local session.*found 2/i);
});

test("patches the current workspace-root layout with an intervening eligibility check", () => {
  const first = patchProjectGroupSource(CURRENT_SOURCE);
  assert.equal(first.status, "patched");
  assert.ok(first.code.includes(LOCAL_HOST_MARKER));
  assert.ok(first.code.includes(ROOT_HOST_MARKER));
  assert.match(first.code, /if\(n\.summary!=null&&!ok\(n\.cwd\)\)continue;/);
  assert.equal(patchProjectGroupSource(first.code).status, "already");
});

test("patches the latest workspace-root layout without treating its assignment as a second local target", () => {
  const first = patchProjectGroupSource(LATEST_SOURCE);
  assert.equal(first.status, "patched");
  assert.deepEqual(first.counts, { local: 1, root: 1 });
  assert.match(first.code, /,p=u\?\.threadProjectAssignments/);
  assert.equal(patchProjectGroupSource(first.code).status, "already");
});

test("patches webpack host calls and reversed null checks without changing eligibility", () => {
  const source = `
    function group(e,u,c,l){let d=null==e.hostId||(0,l.isLocal)(e.hostId)?c:e.hostId,p=u?.threadProjectAssignments?.[e.conversationId];return d}
    function roots(threads,t,a,l,u){let out=[];for(let n of threads){let e=null==n.hostId||(0,l.isLocal)(n.hostId)?t:n.hostId,p=u?.threadProjectAssignments?.[n.conversationId];if(n.summary!=null&&!l.eligible(n.cwd))continue;let r=n.cwd;if(!r||e!==t&&!a.has(e))continue;out.push([e,r]);}return out}
  `;
  const first = patchProjectGroupSource(source);
  assert.deepEqual(first.counts, { local: 1, root: 1 });
  assert.equal(patchProjectGroupSource(first.code).code, first.code);
  const { group, roots } = Function(`${first.code};return {group,roots}`)();
  const helpers = { isLocal: host => host === "local", eligible: cwd => cwd !== "excluded" };
  const options = { enabledRemoteHostIds: new Set(["remote"]), remoteProjects: [{ hostId: "project" }] };
  for (const [hostId, expected] of [[null,"primary"],["local","primary"],["old","primary"],["remote","remote"],["project","project"]]) {
    assert.equal(group({hostId}, options, "primary", helpers), expected);
  }
  assert.equal(group({hostId:"old"}, undefined, "primary", helpers), "primary");
  const threads = [
    {hostId:"old",cwd:"history"}, {hostId:"remote",cwd:"remote-root"},
    {hostId:"old",cwd:"excluded",summary:"skip"}, {hostId:"old",cwd:""},
  ];
  assert.deepEqual(roots(threads,"primary",options.enabledRemoteHostIds,helpers,options), [["primary","history"],["remote","remote-root"]]);
  assert.throws(() => patchProjectGroupSource(source + source), /local session.*found 2/i);
  assert.throws(() => patchProjectGroupSource(source.replace('(0,l.isLocal)(e.hostId)', '(0,l.isLocal)(other.hostId)')), /local session.*found 0/i);
  assert.throws(() => patchProjectGroupSource(source.replace('!a.has(e)', '!a.has(other)')), /host normalization expected exactly 1 target/i);
});

for (const [name, transform] of [
  ["reversed null checks", source => source.replaceAll(/([a-z]+)\.hostId==null/g, "null==$1.hostId")],
  ["webpack calls", source => source.replaceAll(/l\(([^)]+)\)/g, "(0,l.isLocal)($1)")],
]) {
  test(`supports ${name} with both legacy root layouts`, () => {
    for (const original of [SOURCE, CURRENT_SOURCE, LATEST_SOURCE]) {
      const first = patchProjectGroupSource(transform(original));
      assert.deepEqual(first.counts, { local: 1, root: 1 });
      assert.equal(patchProjectGroupSource(first.code).code, first.code);
    }
  });
}
