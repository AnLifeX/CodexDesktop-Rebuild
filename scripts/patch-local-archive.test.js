const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { ANCHOR, patchLocalArchiveSource } = require("./patch-local-archive");

const SOURCE = `class Archive {
  #owner=null;
  constructor(connection){this.connection=connection}
  async owner(){let e=this.connection,t=e?.getCachedAuthenticatedPrincipal();
    if(t!=null)this.#owner=JSON.stringify([t.accountId,t.userId]);
    if(e?.getConnectionState()!=="connected")return null;
    let n=t??await e.getAuthenticatedPrincipal();
    if(n!=null)return this.#owner=JSON.stringify([n.accountId,n.userId]),this.#owner;
    let{account:r,requiresOpenaiAuth:i}=await e.getAccount();return this.#owner=r?.type==="apiKey"||!1===i?"apikey":null}
  async archive(){const owner=await this.owner();if(owner==null)throw Error(${JSON.stringify(ANCHOR)});return owner}
}`;

test("relay ChatGPT uses the existing local owner for manual and automatic archive preparation", async () => {
  const result = patchLocalArchiveSource(SOURCE);
  assert.equal(patchLocalArchiveSource(result.code).status, "already");
  const Archive = vm.runInNewContext(result.code + ";Archive");
  for (const [type, principal, required, expected] of [
    ["chatgpt", null, true, "apikey"],
    ["apiKey", null, true, "apikey"],
    [null, null, false, "apikey"],
    ["chatgpt", { accountId: "real-account", userId: "real-user" }, true, '["real-account","real-user"]'],
  ]) {
    const connection = {
      getCachedAuthenticatedPrincipal: () => principal,
      getAuthenticatedPrincipal: async () => principal,
      getConnectionState: () => "connected",
      getAccount: async () => ({ account: type ? { type } : null, requiresOpenaiAuth: required }),
    };
    assert.equal(await new Archive(connection).archive(), expected);
  }
  for (const state of ["connected", "disconnected"]) {
    const connection = {
      getCachedAuthenticatedPrincipal: () => null,
      getAuthenticatedPrincipal: async () => null,
      getConnectionState: () => state,
      getAccount: async () => ({ account: null, requiresOpenaiAuth: true }),
    };
    await assert.rejects(new Archive(connection).archive(), /Could not determine/);
  }
});

test("supports the previous Rollup getter and fails closed on changed or ambiguous targets", () => {
  const old = SOURCE.replace('r?.type==="apiKey"||!1===i', 'r?.type===`apiKey`||i===!1').replace('?"apikey":null', '?`apikey`:null');
  assert.equal(patchLocalArchiveSource(old).status, "patched");
  assert.throws(() => patchLocalArchiveSource(SOURCE.replace('r?.type==="apiKey"', 'r?.type==="other"')), /fallback changed/);
  assert.throws(() => patchLocalArchiveSource(SOURCE + SOURCE.replaceAll("Archive", "Other")), /found 2/);
  assert.throws(() => patchLocalArchiveSource('const x="/* CodexRebuildLocalArchiveIdentity */";'), /manager is missing/);
});

