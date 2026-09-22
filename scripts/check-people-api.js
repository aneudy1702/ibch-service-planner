export function validatePeoplePayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.people)) {
    throw new Error("People API response must contain a people array.");
  }
  return payload.people;
}

export async function checkPeopleApi(url, fetchImpl = fetch) {
  if (!url) throw new Error("A people API URL is required.");

  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`People API returned malformed JSON (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(`People API health check failed with HTTP ${response.status}.`);
  }

  return validatePeoplePayload(payload);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const url = process.argv[2];
  checkPeopleApi(url)
    .then((people) => console.log(`People API healthy: ${people.length} people.`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
