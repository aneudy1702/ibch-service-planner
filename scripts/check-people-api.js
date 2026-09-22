export function validatePeoplePayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.people)) {
    throw new Error("People API response must contain a people array.");
  }
  return payload.people;
}

class HealthCheckError extends Error {
  constructor(message, { retryable = false, cause } = {}) {
    super(message, { cause });
    this.retryable = retryable;
  }
}

export async function checkPeopleApi(url, fetchImpl = fetch) {
  if (!url) throw new Error("A people API URL is required.");

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
    });
  } catch (cause) {
    throw new HealthCheckError("People API health check could not connect.", {
      retryable: true,
      cause,
    });
  }

  const text = await response.text();

  if (!response.ok) {
    throw new HealthCheckError(`People API health check failed with HTTP ${response.status}.`, {
      retryable: response.status >= 500,
    });
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`People API returned malformed JSON (HTTP ${response.status}).`);
  }

  return validatePeoplePayload(payload);
}

export async function checkPeopleApiWithRetry(
  url,
  {
    fetchImpl = fetch,
    attempts = 5,
    delayMs = 3000,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    onRetry = (error, attempt) => console.warn(`${error.message} Retrying (${attempt}/${attempts})...`),
  } = {},
) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("Health check attempts must be a positive integer.");
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await checkPeopleApi(url, fetchImpl);
    } catch (error) {
      if (!error.retryable || attempt === attempts) throw error;
      onRetry(error, attempt);
      await sleep(delayMs);
    }
  }

  throw new Error("People API health check exhausted its retry attempts.");
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const url = process.argv[2];
  checkPeopleApiWithRetry(url)
    .then((people) => console.log(`People API healthy: ${people.length} people.`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
