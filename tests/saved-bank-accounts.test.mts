import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as liteDrizzle } from "drizzle-orm/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  savedBankAccounts,
  saveBankAccount,
  defaultBankAccount,
  deleteBankAccount,
} from "../src/server/bank-accounts";
import { sealBankDetails, openBankDetails } from "../src/server/bank-secrets";
import { bankAccountInput } from "../src/domain/bank-accounts";
import { createRedemption, redemptionSnapshot, redemptionHistory } from "../src/server/redemption";
import { adminMoneyDetail, completeWithdrawal } from "../src/server/manual-money";
import { withdrawalTransactions } from "../src/server/dashboard";
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.BANK_ACCOUNT_ENCRYPTION_KEY = randomBytes(32).toString("base64url");
const postgres = !!process.env.BANK_ACCOUNT_TEST_URL;
let pool: Pool | undefined;
let lite: PGlite | undefined;
if (postgres) {
  const url = new URL(process.env.BANK_ACCOUNT_TEST_URL!);
  assert.equal(url.hostname, "ep-late-credit-b3qu4dqn.c-4.ap-southeast-1.aws.neon.tech");
  assert.equal(url.pathname, "/saved_banks_qa_20261017");
  for (const k of ["sslmode", "channel_binding"]) url.searchParams.delete(k);
  pool = new Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    max: 10,
    allowExitOnIdle: true,
  });
  (globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase =
    pgDrizzle(pool);
} else {
  lite = new PGlite();
  (globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase =
    liteDrizzle(lite) as unknown as NodePgDatabase;
}
async function query(
  text: string,
  values: unknown[] = [],
): Promise<{ rows: Record<string, any>[] }> {
  if (!pool && !values.length && text.includes(";")) {
    const results = await lite!.exec(text);
    return results[results.length - 1] || { rows: [] };
  }
  return pool ? pool.query(text, values) : lite!.query(text, values);
}
const files = (await readdir("database/migrations")).filter((f) => f.endsWith(".sql")).sort();
if (
  !(await query("SELECT 1 FROM information_schema.schemata WHERE schema_name='cinevjet'")).rows
    .length
) {
  for (const f of files.filter((f) => f < "0019"))
    await query(await readFile("database/migrations/" + f, "utf8"));
  await query(await readFile("database/seed.sql", "utf8"));
}
async function user() {
  const id = randomUUID();
  await query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name)VALUES($1,$2,'unused','Local bank QA')",
    [id, id + "@example.invalid"],
  );
  await query("INSERT INTO cinevjet.wallets(user_id)VALUES($1)", [id]);
  await query("INSERT INTO cinevjet.coin_wallets(user_id,balance)VALUES($1,2000000)", [id]);
  await query(
    "INSERT INTO cinevjet.coin_ledger(id,user_id,amount,type,reference_type,reference_id)VALUES($1,$2,2000000,'QA','QA',$3)",
    [randomUUID(), id, randomUUID()],
  );
  return id;
}
const admin = await user(),
  owner = await user(),
  other = await user();
await query("INSERT INTO cinevjet.admin_users(user_id)VALUES($1)", [admin]);
const legacy = await createRedemption(owner, {
  coins: 35000,
  bank_name: "Legacy QA",
  account_number: "123456789",
  account_name: "LEGACY HOLDER",
  idempotency_key: randomUUID(),
});
const before = (
  await query(
    "SELECT to_jsonb(w)-'bank_account_id'-'bank_snapshot_ciphertext' r FROM cinevjet.withdrawals w WHERE id=$1",
    [legacy.id],
  )
).rows[0].r;
if (
  !(
    await query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='cinevjet' AND table_name='user_bank_accounts'",
    )
  ).rows.length
)
  await query(await readFile("database/migrations/0019_saved_bank_accounts.sql", "utf8"));
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) =>
  String(input) === "https://api.vietqr.io/v2/banks"
    ? Response.json({
        code: "00",
        data: [
          {
            bin: "970436",
            shortName: "VCB",
            name: "Ngân hàng TMCP Ngoại thương Việt Nam",
            transferSupported: 1,
          },
          { bin: "970422", shortName: "MB", name: "Ngân hàng TMCP Quân Đội", transferSupported: 1 },
        ],
      })
    : originalFetch(input, init)) as typeof fetch;
const data = (code = "970436", number = "001234567890") => ({
  bank_code: code,
  account_number: number,
  account_holder_name: "  NGUYEN   QA  ",
  nickname: "Tài khoản nhận thưởng",
});
let first: Awaited<ReturnType<typeof saveBankAccount>>, second: typeof first;
let request: Awaited<ReturnType<typeof createRedemption>>;
const requestKey = randomUUID();
try {
  await test("additive migration preserves existing financial snapshots", async () => {
    const after = (
      await query("SELECT to_jsonb(w) r FROM cinevjet.withdrawals w WHERE id=$1", [legacy.id])
    ).rows[0].r;
    const { bank_account_id, bank_snapshot_ciphertext, ...old } = after;
    assert.deepEqual(old, before);
    assert.equal(bank_account_id, null);
    assert.equal(
      (await adminMoneyDetail(admin, "WITHDRAWAL", legacy.id)).bank_account_number,
      "123456789",
    );
  });
  await test("bank validation normalizes spacing, preserves leading zeros, rejects forged owners and invalid bank codes", async () => {
    assert.equal(bankAccountInput.parse(data()).account_holder_name, "NGUYEN QA");
    assert.equal(
      bankAccountInput.parse({ ...data(), account_number: "00 1234 567890" }).account_number,
      "001234567890",
    );
    for (const n of ["", "123", "123a456", "-123456", "0".repeat(41)])
      assert.equal(bankAccountInput.safeParse({ ...data(), account_number: n }).success, false);
    assert.equal(bankAccountInput.safeParse({ ...data(), user_id: other }).success, false);
    await assert.rejects(() => saveBankAccount(owner, data("999999")));
  });
  await test("first saved bank persists encrypted in database and DTO exposes only a masked number", async () => {
    first = await saveBankAccount(owner, data());
    assert.equal(first.is_default, true);
    assert.equal(first.account_holder_name, "NGUYEN QA");
    assert.equal(JSON.stringify(first).includes("001234567890"), false);
    const row = (await query("SELECT * FROM cinevjet.user_bank_accounts WHERE id=$1", [first.id]))
      .rows[0];
    assert.equal(JSON.stringify(row).includes("001234567890"), false);
    assert.equal(JSON.stringify(row).includes("NGUYEN QA"), false);
    assert.equal(row.details_ciphertext.split(".").length, 5);
    assert.equal((await savedBankAccounts(owner))[0].id, first.id);
    await assert.rejects(() => saveBankAccount(owner, data()));
  });
  await test("second bank and explicit defaults are distinct from selecting a request recipient", async () => {
    second = await saveBankAccount(owner, data("970422", "000987654321"));
    assert.equal(second.is_default, false);
    await defaultBankAccount(owner, second.id);
    request = await createRedemption(owner, {
      coins: 35000,
      bank_account_id: first.id,
      idempotency_key: requestKey,
    });
    assert.equal(request.fee, 1400);
    assert.equal(request.amount - request.fee, 33600);
    assert.equal((await savedBankAccounts(owner)).find((a) => a.is_default)?.id, second.id);
    assert.equal(request.status, "PENDING");
    assert.equal(
      (await withdrawalTransactions(admin)).items.some((r) => r.id === request.id),
      true,
    );
  });
  await test("IDOR blocks listing, editing, defaults, deletes and redemption with another user bank", async () => {
    assert.deepEqual(await savedBankAccounts(other), []);
    await assert.rejects(() => saveBankAccount(other, data(), first.id));
    await assert.rejects(() => defaultBankAccount(other, first.id));
    await assert.rejects(() => deleteBankAccount(other, first.id));
    await assert.rejects(() =>
      createRedemption(other, {
        coins: 35000,
        bank_account_id: first.id,
        idempotency_key: randomUUID(),
      }),
    );
    assert.equal((await redemptionSnapshot(other)).reserved, 0);
    await assert.rejects(() => adminMoneyDetail(other, "WITHDRAWAL", request.id));
  });
  await test("withdrawal snapshot is encrypted, immutable and available only in authorized admin detail", async () => {
    const row = (await query("SELECT * FROM cinevjet.withdrawals WHERE id=$1", [request.id]))
      .rows[0];
    assert.equal(JSON.stringify(row).includes("001234567890"), false);
    assert.equal(JSON.stringify(row).includes("NGUYEN QA"), false);
    assert.equal(row.bank_account_id, first.id);
    assert.ok(row.bank_snapshot_ciphertext);
    const detail = await adminMoneyDetail(admin, "WITHDRAWAL", request.id);
    assert.equal(detail.bank_account_number, "001234567890");
    assert.equal(detail.bank_account_name, "NGUYEN QA");
    const updated = await saveBankAccount(
      owner,
      { ...data(), account_number: "222233334444", account_holder_name: "NEW HOLDER" },
      first.id,
    );
    assert.notEqual(updated.id, first.id);
    first = updated;
    assert.equal(
      (await adminMoneyDetail(admin, "WITHDRAWAL", request.id)).bank_account_number,
      "001234567890",
    );
    const retry = await createRedemption(owner, {
      coins: 35000,
      bank_account_id: row.bank_account_id,
      idempotency_key: requestKey,
    });
    assert.equal(retry.id, request.id);
    await deleteBankAccount(owner, first.id);
    assert.equal(
      (await adminMoneyDetail(admin, "WITHDRAWAL", request.id)).bank_account_name,
      "NGUYEN QA",
    );
    assert.equal(
      (await redemptionHistory(owner))
        .find((r) => r.id === request.id)
        ?.bank_account_number?.includes("001234567890"),
      false,
    );
  });
  await test("fees, custom amounts, holds and rejection preserve existing coin rules", async () => {
    for (const [coins, fee] of [
      [70000, 2800],
      [110000, 4400],
      [110001, 4401],
    ]) {
      const r = await createRedemption(owner, {
        coins,
        bank_account_id: second.id,
        idempotency_key: randomUUID(),
      });
      assert.equal(r.fee, fee);
      await completeWithdrawal(admin, r.id, { action: "REJECT", reason: "Isolated QA" });
      await assert.rejects(() =>
        completeWithdrawal(admin, r.id, { action: "REJECT", reason: "Repeat" }),
      );
    }
    for (const coins of [-1, 0, 50000, 110000.5, 3000000])
      await assert.rejects(() =>
        createRedemption(owner, {
          coins,
          bank_account_id: second.id,
          idempotency_key: randomUUID(),
        }),
      );
    const snapshot = await redemptionSnapshot(owner);
    assert.equal(snapshot.balance, 2000000);
    assert.equal(snapshot.reserved, 70000);
  });
  await test("deleting default selects the oldest remaining active bank; history is retained", async () => {
    const next = await saveBankAccount(owner, data("970436", "555566667777"));
    await deleteBankAccount(owner, second.id);
    assert.equal((await savedBankAccounts(owner)).find((a) => a.is_default)?.id, next.id);
    assert.ok((await redemptionHistory(owner)).some((r) => r.id === request.id));
    await deleteBankAccount(owner, next.id);
    assert.deepEqual(await savedBankAccounts(owner), []);
  });
  await test("authenticated encryption rejects tampering and wrong user/record binding", async () => {
    const cipher = await sealBankDetails(
      { account_number: "1234567890", account_holder_name: "PRIVATE HOLDER" },
      "one",
    );
    await assert.rejects(() => openBankDetails(cipher, "two"));
    await assert.rejects(() => openBankDetails(cipher.slice(0, -10) + "AAAAAAAAAA", "one"));
    const old = process.env.BANK_ACCOUNT_ENCRYPTION_KEY;
    delete process.env.BANK_ACCOUNT_ENCRYPTION_KEY;
    await assert.rejects(() => saveBankAccount(owner, data()));
    process.env.BANK_ACCOUNT_ENCRYPTION_KEY = old;
  });
  await test(
    "real PostgreSQL concurrency: one default, no duplicate accounts, idempotent holds, no overdraft",
    { skip: !postgres },
    async () => {
      const u = await user();
      const a = await saveBankAccount(u, data()),
        b = await saveBankAccount(u, data("970422", "333344445555"));
      await Promise.all(
        Array.from({ length: 8 }, (_, i) => defaultBankAccount(u, i % 2 ? a.id : b.id)),
      );
      assert.equal((await savedBankAccounts(u)).filter((a) => a.is_default).length, 1);
      const duplicates = await Promise.allSettled(
        Array.from({ length: 4 }, () => saveBankAccount(u, data("970436", "777788889999"))),
      );
      assert.equal(duplicates.filter((r) => r.status === "fulfilled").length, 1);
      const body = { coins: 35000, bank_account_id: a.id, idempotency_key: randomUUID() };
      const repeated = await Promise.all(
        Array.from({ length: 5 }, () => createRedemption(u, body)),
      );
      assert.equal(new Set(repeated.map((r) => r.id)).size, 1);
      assert.equal((await redemptionSnapshot(u)).reserved, 35000);
      const races = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          createRedemption(u, {
            coins: 1100000,
            bank_account_id: a.id,
            idempotency_key: randomUUID(),
          }),
        ),
      );
      assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await redemptionSnapshot(u)).reserved, 1135000);
    },
  );
  await test("saved-bank completion needs transfer evidence and debits ledger only once", async () => {
    await assert.rejects(() =>
      completeWithdrawal(admin, request.id, { action: "COMPLETE", confirmed: true }),
    );
    const proof = randomUUID();
    await query(
      "INSERT INTO cinevjet.deposit_bills(id,user_id,url,content_type,size_bytes,width,height)VALUES($1,$2,$3,'image/webp',1,1,1)",
      [proof, admin, "https://qa.invalid/" + proof + ".webp"],
    );
    await completeWithdrawal(admin, request.id, {
      action: "COMPLETE",
      confirmed: true,
      evidence_reference: "ISOLATED-QA-" + proof,
      proof_bill_id: proof,
    });
    await assert.rejects(() =>
      completeWithdrawal(admin, request.id, {
        action: "COMPLETE",
        confirmed: true,
        evidence_reference: "ISOLATED-QA-" + proof,
        proof_bill_id: proof,
      }),
    );
    assert.equal(
      Number(
        (
          await query(
            "SELECT count(*)::int n FROM cinevjet.coin_ledger WHERE user_id=$1 AND reference_type='REDEMPTION' AND reference_id=$2",
            [owner, request.id],
          )
        ).rows[0].n,
      ),
      1,
    );
    const oldBank = (
      await query("SELECT bank_account_id FROM cinevjet.withdrawals WHERE id=$1", [request.id])
    ).rows[0].bank_account_id;
    assert.equal(
      (
        await createRedemption(owner, {
          coins: 35000,
          bank_account_id: oldBank,
          idempotency_key: requestKey,
        })
      ).status,
      "COMPLETED",
    );
    assert.equal(
      (await adminMoneyDetail(admin, "WITHDRAWAL", request.id)).bank_account_number,
      "001234567890",
    );
  });
} finally {
  globalThis.fetch = originalFetch;
  if (pool) await pool.end();
  if (lite) await lite.close();
}
