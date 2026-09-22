import fs from "node:fs";

export function getD1InfoId(info) {
  const record = Array.isArray(info) ? info[0] : info;
  return record?.uuid || record?.id || null;
}

export function getConfiguredDatabaseId(configText) {
  const match = configText.match(/^database_id\s*=\s*"([^"]+)"/m);
  return match?.[1] || null;
}

export function verifyD1Config(info, configText) {
  const actualId = getD1InfoId(info);
  const configuredId = getConfiguredDatabaseId(configText);
  if (!actualId) throw new Error("Wrangler D1 info did not include a database UUID.");
  if (!configuredId) throw new Error("wrangler.toml does not define database_id.");
  if (actualId !== configuredId) {
    throw new Error("The D1 database UUID does not match wrangler.toml.");
  }
  return actualId;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const info = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const configText = fs.readFileSync(process.argv[3], "utf8");
    const databaseId = verifyD1Config(info, configText);
    console.log(`D1 configuration verified: ${databaseId}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
