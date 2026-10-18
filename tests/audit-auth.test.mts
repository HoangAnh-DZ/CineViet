import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  createRegistrationChallenge,
  verifyRegistrationChallenge,
  digest,
} from "../src/server/auth-core";
const pg = new PGlite();
for (const name of (await readdir("database/migrations")).filter((n) => n.endsWith(".sql")).sort())
  await pg.exec(await readFile("database/migrations/" + name, "utf8"));
(globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase = drizzle(
  pg,
) as unknown as NodePgDatabase;
process.env.AUTH_SECRET = "isolated-audit-auth-secret-at-least-32-characters";
async function challengeWithKnownAnswer() {
  const challenge = await createRegistrationChallenge();
  assert.equal("code" in challenge, false);
  assert.match(challenge.image, /^data:image\/png;base64,/);
  // Set a known answer only inside the isolated database, never in application output.
  await pg.query("UPDATE cinevjet.registration_challenges SET code_hash=$1 WHERE id=$2", [
    digest(`${challenge.id}:ABCD`),
    challenge.id,
  ]);
  return challenge;
}
test("wrong verification attempts persist and the fifth failure locks even a correct answer", async () => {
  const challenge = await challengeWithKnownAnswer();
  const code = "WXYZ";
  for (let n = 1; n <= 5; n++) {
    await assert.rejects(
      () => verifyRegistrationChallenge({ id: challenge.id, code }),
      (e) => (e as { status: number }).status === 400,
    );
    assert.equal(
      (
        await pg.query("SELECT attempts FROM cinevjet.registration_challenges WHERE id=$1", [
          challenge.id,
        ])
      ).rows[0].attempts,
      n,
    );
  }
  await assert.rejects(
    () => verifyRegistrationChallenge({ id: challenge.id, code: "ABCD" }),
    (e) => (e as { status: number }).status === 429,
  );
});
test("a challenge can be consumed once under overlapping requests", async () => {
  const challenge = await challengeWithKnownAnswer();
  const attempts = await Promise.allSettled(
    Array.from({ length: 3 }, () =>
      verifyRegistrationChallenge({ id: challenge.id, code: "ABCD" }),
    ),
  );
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((r) => r.status === "rejected").length, 2);
});
test.after(() => pg.close());
