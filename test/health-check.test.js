import test from "node:test";
import assert from "node:assert/strict";

import {
  checkPeopleApi,
  checkPeopleApiWithRetry,
  validatePeoplePayload,
} from "../scripts/check-people-api.js";
import { verifyD1Config } from "../scripts/verify-d1-config.js";

test("accepts a people API payload with a people array", () => {
  assert.deepEqual(validatePeoplePayload({ people: [] }), []);
});

test("rejects a successful response without a people array", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ people: null }), { status: 200 });
  await assert.rejects(() => checkPeopleApi("https://example.test/api/people", fetchImpl), /people array/);
});

test("rejects unsuccessful and malformed API responses", async () => {
  const failedFetch = async () => new Response(JSON.stringify({ error: "missing DB" }), { status: 500 });
  await assert.rejects(() => checkPeopleApi("https://example.test/api/people", failedFetch), /HTTP 500/);

  let malformedCalls = 0;
  const malformedFetch = async () => {
    malformedCalls += 1;
    return new Response("not json", { status: 200 });
  };
  await assert.rejects(
    () => checkPeopleApiWithRetry("https://example.test/api/people", {
      fetchImpl: malformedFetch,
      sleep: async () => undefined,
      onRetry: () => undefined,
    }),
    /malformed JSON/,
  );
  assert.equal(malformedCalls, 1);
});

test("retries a transient HTTP 500 and then succeeds", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ error: "temporary" }), { status: 500 })
      : new Response(JSON.stringify({ people: [] }), { status: 200 });
  };

  const people = await checkPeopleApiWithRetry("https://example.test/api/people", {
    fetchImpl,
    attempts: 5,
    delayMs: 0,
    sleep: async () => undefined,
    onRetry: () => undefined,
  });

  assert.deepEqual(people, []);
  assert.equal(calls, 2);
});

test("retries a network failure and then succeeds", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("network unavailable");
    return new Response(JSON.stringify({ people: [{ id: "person-1" }] }), { status: 200 });
  };

  const people = await checkPeopleApiWithRetry("https://example.test/api/people", {
    fetchImpl,
    delayMs: 0,
    sleep: async () => undefined,
    onRetry: () => undefined,
  });

  assert.equal(people.length, 1);
  assert.equal(calls, 2);
});

test("does not retry a permanent HTTP 4xx response", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  };

  await assert.rejects(
    () => checkPeopleApiWithRetry("https://example.test/api/people", {
      fetchImpl,
      sleep: async () => undefined,
      onRetry: () => undefined,
    }),
    /HTTP 403/,
  );
  assert.equal(calls, 1);
});

test("fails after exhausting bounded retries", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 503 });
  };

  await assert.rejects(
    () => checkPeopleApiWithRetry("https://example.test/api/people", {
      fetchImpl,
      attempts: 3,
      delayMs: 0,
      sleep: async () => undefined,
      onRetry: () => undefined,
    }),
    /HTTP 503/,
  );
  assert.equal(calls, 3);
});

test("verifies the deployed D1 UUID matches the Wrangler binding", () => {
  const id = "9ec96597-11d5-4569-b509-cc9bbf5f0e84";
  assert.equal(
    verifyD1Config({ uuid: id }, `[[d1_databases]]\ndatabase_id = "${id}"`),
    id,
  );
  assert.throws(
    () => verifyD1Config({ uuid: "different" }, `database_id = "${id}"`),
    /does not match/,
  );
});
