import test from "node:test";
import assert from "node:assert/strict";

import { checkPeopleApi, validatePeoplePayload } from "../scripts/check-people-api.js";
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

  const malformedFetch = async () => new Response("not json", { status: 200 });
  await assert.rejects(() => checkPeopleApi("https://example.test/api/people", malformedFetch), /malformed JSON/);
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
