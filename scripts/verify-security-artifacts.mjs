import assert from "node:assert/strict";
import fs from "node:fs";
function files(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? files(`${root}/${d.name}`) : [`${root}/${d.name}`]));
}
export function artifactFindings(source) {
  const findings = [];
  for (const [rule, pattern] of [
    ["database-url", /postgres(?:ql)?:\/\/[^\s"'`]+/i],
    ["blob-token", /vercel_blob_rw_[A-Za-z0-9_]{20,}/],
    [
      "server-secret-code",
      /AUTH_SECRET cần tối thiểu|process\.env\.(?:AUTH_SECRET|DATABASE_URL|PAYOS_API_KEY|PAYOS_CHECKSUM_KEY|BANK_ACCOUNT_ENCRYPTION_KEY|CRON_SECRET)/,
    ],
    ["financial-server-sql", /(?:INSERT INTO|UPDATE|DELETE FROM) cinevjet\./],
  ])
    if (pattern.test(source)) findings.push(rule);
  // Crypto libraries contain PEM format labels. Flag actual key material, not
  // a parser's BEGIN/END string constants. Never print a matched secret.
  for (const match of source.matchAll(
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----([\s\S]{128,12000}?)-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  )) {
    const body = match[1].replace(/\\[rn]|\s/g, "");
    if (/^[A-Za-z0-9+/=]{128,}$/.test(body)) findings.push("private-key-material");
  }
  return findings;
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/verify-security-artifacts.mjs")) {
  const all = files(".next/static"),
    maps = all.filter((p) => p.endsWith(".map")),
    chunks = all.filter((p) => p.endsWith(".js"));
  const findings = chunks.flatMap((p) =>
    artifactFindings(fs.readFileSync(p, "utf8")).map((rule) => ({ file: p, rule })),
  );
  assert.equal(maps.length, 0, "Client source maps must not be emitted");
  assert.deepEqual(findings, [], "Review potential exposure without printing its value");
  console.log(
    JSON.stringify({
      status: "PASS",
      clientChunks: chunks.length,
      sourceMaps: maps.length,
      exposurePatternFindings: findings.length,
      scope:
        "artifact patterns and server/client boundaries; no Production secret values downloaded",
    }),
  );
}
