const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const https = require("node:https");
const test = require("node:test");
const { getCookie } = require("./fetch-msstore");

function mockResponses(t, outcomes) {
  const requests = [];
  t.mock.method(https, "request", (options, respond) => {
    const request = new EventEmitter();
    const outcome = outcomes[requests.length];
    assert.notEqual(outcome, undefined, "request count exceeded the retry limit");
    const captured = { options, body: "" };
    requests.push(captured);
    let timeout;
    request.setTimeout = (_ms, callback) => { timeout = callback; };
    request.write = (body) => { captured.body += body; };
    request.destroy = (error) => request.emit("error", error);
    request.end = () => queueMicrotask(() => {
      if (outcome === "timeout") return timeout();
      if (outcome instanceof Error) return request.destroy(outcome);
      const response = new EventEmitter();
      response.statusCode = outcome;
      response.headers = {};
      respond(response);
      response.emit("data", Buffer.from("<Envelope><EncryptedData>cookie</EncryptedData></Envelope>"));
      response.emit("end");
    });
    return request;
  });
  return requests;
}

test("retries Store timeouts and temporary HTTP failures with the same SOAP request", async (t) => {
  const requests = mockResponses(t, ["timeout", 503, 200]);
  assert.equal(await getCookie(), "cookie");
  assert.equal(requests.length, 3);
  assert.ok(requests[0].body.includes("GetCookie"));
  assert.deepEqual(requests[1], requests[0]);
  assert.deepEqual(requests[2], requests[0]);
});

test("stops after three Store timeouts and preserves the failure", async (t) => {
  const requests = mockResponses(t, ["timeout", "timeout", "timeout"]);
  await assert.rejects(getCookie(), /Request timeout/);
  assert.equal(requests.length, 3);
});

test("does not retry certificate errors or permanent HTTP failures", async (t) => {
  for (const outcome of [Object.assign(new Error("untrusted certificate"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }), 404]) {
    await t.test(String(outcome), async (t) => {
      const requests = mockResponses(t, [outcome]);
      await assert.rejects(getCookie(), outcome === 404 ? /HTTP 404/ : /untrusted certificate/);
      assert.equal(requests.length, 1);
    });
  }
});
