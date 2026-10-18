import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { hash, compare } from "bcryptjs";
import {
  changePassword,
  requestEmailChange,
  confirmEmailChange,
  updateDisplayName,
} from "../src/server/account-security";
import { newSession, resolveSession, login } from "../src/server/auth-core";
import { updateTransactionSettings } from "../src/server/admin-settings-update";
import { adminReferralPolicy, updateReferralPolicy } from "../src/server/referral-policy";
import { createVipPurchase, approveVipPurchase } from "../src/server/vip-purchases";
import { commissionAmount } from "../src/domain/referral-policy";
const url = new URL(process.env.REFERRAL_TEST_DATABASE_URL!);
assert.equal(url.hostname, "ep-late-credit-b3qu4dqn.c-4.ap-southeast-1.aws.neon.tech");
assert.match(url.pathname, /^\/financial_reporting_20261018_[a-f0-9]{8}$/);
const role = "cinevjet_runtime_finance_20261018";
assert.equal(process.env.REFERRAL_QA_ROLE, role);
const owner = new Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  max: 1,
});
const runtime = new Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  options: "-c role=" + role,
  max: 6,
});
(globalThis as any).cinevjetDatabase = drizzle(runtime);
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
delete process.env.PAYOS_API_KEY;
const q = owner.query.bind(owner),
  password = randomBytes(24).toString("base64url");
async function fixture(parent: string | null = null, admin = false) {
  const id = randomUUID(),
    email = id + "@example.invalid";
  await q(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name,referred_by) VALUES($1,$2,$3,'Account QA',$4)",
    [id, email, await hash(password, 12), parent],
  );
  await q("INSERT INTO cinevjet.wallets(user_id,balance) VALUES($1,77)", [id]);
  await q("INSERT INTO cinevjet.coin_wallets(user_id,balance) VALUES($1,88)", [id]);
  if (admin) await q("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [id]);
  return { id, email, ...(await session(id)) };
}
async function session(id: string) {
  const s = newSession();
  await q("INSERT INTO cinevjet.sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,$4)", [
    s.id,
    id,
    s.tokenHash,
    s.expires,
  ]);
  return { token: s.token };
}
async function unchanged(id: string) {
  return (
    await q(
      "SELECT u.id,u.referred_by,w.balance::text cash,c.balance::text coins,(SELECT count(*) FROM cinevjet.vip_subscriptions s WHERE s.user_id=u.id)::int vip,(SELECT count(*) FROM cinevjet.admin_users a WHERE a.user_id=u.id)::int admin FROM cinevjet.users u JOIN cinevjet.wallets w ON w.user_id=u.id JOIN cinevjet.coin_wallets c ON c.user_id=u.id WHERE u.id=$1",
      [id],
    )
  ).rows[0];
}
const originalFetch = globalThis.fetch;
let delivered = "";
globalThis.fetch = async (input, init) => {
  assert.equal(String(input), "https://api.resend.com/emails");
  const body = JSON.parse(String(init?.body));
  delivered = body.text;
  return Response.json({ id: "synthetic-mail-" + randomUUID() });
};
function configureMail() {
  process.env.RESEND_API_KEY = "synthetic-qa-key";
  process.env.ACCOUNT_EMAIL_FROM = "qa@example.invalid";
}
const tokenFromMail = () =>
  new URL(delivered.match(/https:\/\/\S+/)![0]).searchParams.get("email_token")!;
test("account and unrestricted commission QA", async (t) => {
  await t.test(
    "concurrent credential changes cannot create a session using stale credentials",
    async () => {
      for (const column of ["email", "password_hash"]) {
        const u = await fixture();
        const db = (globalThis as any).cinevjetDatabase;
        let read!: () => void, resume!: () => void;
        const observed = new Promise<void>((r) => (read = r)),
          release = new Promise<void>((r) => (resume = r));
        (globalThis as any).cinevjetDatabase = new Proxy(db, {
          get(target, key) {
            if (key === "execute")
              return async (...args: any[]) => {
                const result = await target.execute(...args);
                read();
                await release;
                return result;
              };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const pending = login({ email: u.email, password });
        try {
          await observed;
          await q(`UPDATE cinevjet.users SET ${column}=$1 WHERE id=$2`, [
            column === "email"
              ? randomUUID() + "@example.invalid"
              : await hash("Race-new-QA-password!", 12),
            u.id,
          ]);
          resume();
          await assert.rejects(pending, (e) => (e as any).status === 401);
        } finally {
          resume();
          (globalThis as any).cinevjetDatabase = db;
        }
      }
    },
  );
  await t.test("exact runtime role and append-only account audit", async () => {
    assert.equal((await runtime.query("SELECT current_user r")).rows[0].r, role);
    for (const s of [
      "UPDATE cinevjet.account_security_audit SET action=action",
      "DELETE FROM cinevjet.account_security_audit",
      "UPDATE cinevjet.admin_users SET user_id=user_id",
    ])
      await assert.rejects(runtime.query(s), (e) => (e as any).code === "42501");
  });
  await t.test(
    "name changes validate server input and audit without changing ownership or money",
    async () => {
      const u = await fixture(null, true),
        before = await unchanged(u.id);
      await assert.rejects(updateDisplayName(u.id, { display_name: "x" }));
      await assert.rejects(updateDisplayName(u.id, { display_name: "New QA", role: "ADMIN" }));
      assert.equal(
        (await updateDisplayName(u.id, { display_name: "Updated QA" })).user.username,
        "Updated QA",
      );
      assert.deepEqual(await unchanged(u.id), before);
      assert.equal(
        (
          await q(
            "SELECT count(*)::int n FROM cinevjet.account_security_audit WHERE user_id=$1 AND action='DISPLAY_NAME_CHANGED'",
            [u.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "password proof, confirmation and strict input failures keep sessions intact",
    async () => {
      const u = await fixture();
      await assert.rejects(
        changePassword(u.id, u.token, {
          current_password: "wrong",
          new_password: "New-password-123",
          confirm_password: "New-password-123",
        }),
      );
      await assert.rejects(
        changePassword(u.id, u.token, {
          current_password: password,
          new_password: "New-password-123",
          confirm_password: "different",
        }),
      );
      await assert.rejects(
        changePassword(u.id, u.token, {
          current_password: password,
          new_password: "New-password-123",
          confirm_password: "New-password-123",
          user_id: randomUUID(),
        }),
      );
      assert.ok(await resolveSession(u.token));
      assert.ok(
        await compare(
          password,
          (await q("SELECT password_hash FROM cinevjet.users WHERE id=$1", [u.id])).rows[0]
            .password_hash,
        ),
      );
    },
  );
  await t.test(
    "password rotation revokes every old token and preserves Admin and balances",
    async () => {
      const u = await fixture(null, true),
        other = await session(u.id),
        before = await unchanged(u.id),
        next = "New-QA-password-123!";
      const result = await changePassword(u.id, u.token, {
        current_password: password,
        new_password: next,
        confirm_password: next,
      });
      assert.equal(await resolveSession(u.token), null);
      assert.equal(await resolveSession(other.token), null);
      assert.equal((await resolveSession(result.session.token))?.id, u.id);
      assert.deepEqual(await unchanged(u.id), before);
      await assert.rejects(login({ email: u.email, password }));
      assert.equal((await login({ email: u.email, password: next })).user.id, u.id);
    },
  );
  await t.test("no mail service fails closed without changing email", async () => {
    delete process.env.RESEND_API_KEY;
    const u = await fixture();
    await assert.rejects(
      requestEmailChange(
        u.id,
        u.token,
        { email: randomUUID() + "@example.invalid", current_password: password },
        "https://cine-vjet.cyou",
      ),
      (e) => (e as any).status === 503,
    );
    assert.equal(
      (await q("SELECT email FROM cinevjet.users WHERE id=$1", [u.id])).rows[0].email,
      u.email,
    );
  });
  await t.test(
    "email requires password, delivery, ownership, unexpired token and same actor",
    async () => {
      configureMail();
      const u = await fixture(),
        other = await fixture(),
        email = randomUUID() + "@example.invalid";
      await assert.rejects(
        requestEmailChange(
          u.id,
          u.token,
          { email, current_password: "wrong" },
          "https://cine-vjet.cyou",
        ),
      );
      await requestEmailChange(
        u.id,
        u.token,
        { email, current_password: password },
        "https://cine-vjet.cyou",
      );
      const token = tokenFromMail();
      assert.equal(
        (await q("SELECT email FROM cinevjet.users WHERE id=$1", [u.id])).rows[0].email,
        u.email,
      );
      assert.notEqual(
        (await q("SELECT token_hash FROM cinevjet.email_change_requests WHERE user_id=$1", [u.id]))
          .rows[0].token_hash,
        token,
      );
      await assert.rejects(confirmEmailChange(other.id, other.token, { token }));
      await q(
        "UPDATE cinevjet.email_change_requests SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [u.id],
      );
      await assert.rejects(confirmEmailChange(u.id, u.token, { token }));
    },
  );
  await t.test(
    "verified email changes once, rotates sessions, audits and preserves identity/money",
    async () => {
      configureMail();
      const u = await fixture(null, true),
        before = await unchanged(u.id),
        email = randomUUID() + "@example.invalid";
      await requestEmailChange(
        u.id,
        u.token,
        { email, current_password: password },
        "https://cine-vjet.cyou",
      );
      const token = tokenFromMail();
      const results = await Promise.allSettled([
        confirmEmailChange(u.id, u.token, { token }),
        confirmEmailChange(u.id, u.token, { token }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const result = (
        results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<
          Awaited<ReturnType<typeof confirmEmailChange>>
        >
      ).value;
      assert.equal(result.user.email, email);
      assert.equal(await resolveSession(u.token), null);
      assert.equal((await resolveSession(result.session.token))?.email, email);
      assert.deepEqual(await unchanged(u.id), before);
      assert.equal(
        (
          await q(
            "SELECT count(*)::int n FROM cinevjet.account_security_audit WHERE user_id=$1 AND action='EMAIL_CHANGED'",
            [u.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test("duplicate emails and failed delivery never update the account", async () => {
    configureMail();
    const u = await fixture(),
      other = await fixture();
    await assert.rejects(
      requestEmailChange(
        u.id,
        u.token,
        { email: other.email, current_password: password },
        "https://cine-vjet.cyou",
      ),
    );
    globalThis.fetch = async () =>
      Response.json({ error: "synthetic unavailable" }, { status: 503 });
    await assert.rejects(
      requestEmailChange(
        u.id,
        u.token,
        { email: randomUUID() + "@example.invalid", current_password: password },
        "https://cine-vjet.cyou",
      ),
    );
    assert.equal(
      (await q("SELECT email FROM cinevjet.users WHERE id=$1", [u.id])).rows[0].email,
      u.email,
    );
  });
  await t.test(
    "hidden bank configuration cannot be overwritten by settings UI payload",
    async () => {
      const u = await fixture(null, true);
      const before = (
        await q(
          "SELECT bank_name,account_name,account_number FROM cinevjet.system_settings WHERE id='default'",
        )
      ).rows[0];
      const payload = {
        deposit_enabled: true,
        withdrawal_enabled: true,
        min_deposit: 10000,
        min_withdrawal: 35000,
        max_amount: 100_000_000,
        withdrawal_fee_bps: 400,
      };
      await updateTransactionSettings(u.id, payload);
      assert.deepEqual(
        (
          await q(
            "SELECT bank_name,account_name,account_number FROM cinevjet.system_settings WHERE id='default'",
          )
        ).rows[0],
        before,
      );
      await assert.rejects(
        updateTransactionSettings(u.id, { ...payload, account_number: "999999999" }),
      );
    },
  );
  await t.test(
    "rates above 100% and decimals settle exactly once without a budget cap",
    async () => {
      await q(
        "UPDATE cinevjet.system_settings SET bank_name='QA BANK',account_number='123456789',account_name='ISOLATED QA',deposit_enabled=true WHERE id='default'",
      );
      const a = await fixture(null, true),
        b = await fixture(a.id),
        c = await fixture(b.id),
        d = await fixture(c.id);
      const policy = await adminReferralPolicy(a.id);
      await updateReferralPolicy(a.id, {
        expected_version: policy.version,
        rates_bps: [12025, 250, 125],
        reason: "Synthetic above 100 percent policy",
        confirmation: "CONFIRM_FUTURE_ORDERS",
      });
      const request = await createVipPurchase(d.id, {
        plan_id: "VIP_1",
        idempotency_key: randomUUID(),
      });
      await approveVipPurchase(a.id, request.id, {
        action: "APPROVE",
        confirmed: true,
        evidence_reference: "QA/" + request.id,
      });
      assert.deepEqual(
        (
          await q(
            "SELECT amount::text FROM cinevjet.referral_commission_entries WHERE source_id=$1 ORDER BY level",
            [request.id],
          )
        ).rows.map((r) => Number(r.amount)),
        [180375, 3750, 1875],
      );
      await assert.rejects(
        approveVipPurchase(a.id, request.id, {
          action: "APPROVE",
          confirmed: true,
          evidence_reference: "QA/" + request.id,
        }),
      );
      assert.equal(
        (
          await q(
            "SELECT count(*)::int n FROM cinevjet.wallet_ledger l JOIN cinevjet.referral_commission_entries c ON l.reference_id=c.id AND l.reference_type='REFERRAL_V2' WHERE c.source_id=$1",
            [request.id],
          )
        ).rows[0].n,
        3,
      );
    },
  );
  await t.test("overflow fails before creating a payment obligation", async () => {
    assert.throws(() => commissionAmount(Number.MAX_SAFE_INTEGER, 2147483647));
    const a = await fixture(null, true),
      b = await fixture(a.id),
      p = await adminReferralPolicy(a.id);
    await updateReferralPolicy(a.id, {
      expected_version: p.version,
      rates_bps: [2147483647, 0, 0],
      reason: "Synthetic precision limit test",
      confirmation: "CONFIRM_FUTURE_ORDERS",
    });
    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL cinevjet.referral_v2='on'");
      await assert.rejects(
        client.query(
          "INSERT INTO cinevjet.vip_purchase_requests(id,user_id,plan_id,reward_tier,amount,status,idempotency_key) VALUES($1,$2,'VIP_1','VIP_1',9007199254740991,'PENDING',$1)",
          [randomUUID(), b.id],
        ),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  await t.test("account mutation throttles repeated attempts", async () => {
    const u = await fixture();
    for (let i = 0; i < 6; i++)
      await assert.rejects(
        changePassword(u.id, u.token, {
          current_password: "wrong",
          new_password: "QA-new-password-123",
          confirm_password: "QA-new-password-123",
        }),
      );
    await assert.rejects(
      changePassword(u.id, u.token, {
        current_password: password,
        new_password: "QA-new-password-123",
        confirm_password: "QA-new-password-123",
      }),
      (e) => (e as any).status === 429,
    );
  });
});
test.after(async () => {
  globalThis.fetch = originalFetch;
  await runtime.end();
  await owner.end();
});
