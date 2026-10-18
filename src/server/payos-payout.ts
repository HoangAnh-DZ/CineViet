import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ApiError } from "./http";
export function payoutConfigured() {
  // Separate payOS transfer channel. Never silently reuse collection credentials.
  return !!(
    process.env.PAYOS_PAYOUT_CLIENT_ID &&
    process.env.PAYOS_PAYOUT_API_KEY &&
    process.env.PAYOS_PAYOUT_CHECKSUM_KEY
  );
}
export function autoPayoutEnabled() {
  return (
    payoutConfigured() &&
    process.env.PAYOS_AUTO_PAYOUT_ENABLED === "true" &&
    process.env.PAYOS_PAYOUT_ACCESS_VERIFIED === "true"
  );
}
function deepSort(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(deepSort);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, deepSort(x)]),
    );
  return v;
}
export function payoutCanonical(data: Record<string, unknown>) {
  return Object.entries(deepSort(data) as Record<string, unknown>)
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v))}`,
    )
    .join("&");
}
function signature(data: Record<string, unknown>) {
  if (!payoutConfigured()) throw new ApiError(503, "Chưa cấu hình API chuyển tiền tự động.");
  return createHmac("sha256", process.env.PAYOS_PAYOUT_CHECKSUM_KEY!)
    .update(payoutCanonical(data))
    .digest("hex");
}
export class PayoutError extends Error {
  constructor(
    public safeCode: string,
    public httpStatus = 0,
  ) {
    super("API chuyển tiền chưa xác nhận kết quả.");
  }
}
async function request(path: string, body?: Record<string, unknown>, key?: string) {
  if (!payoutConfigured()) throw new PayoutError("NOT_CONFIGURED");
  let r: Response;
  try {
    r = await fetch(`https://api-merchant.payos.vn${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": process.env.PAYOS_PAYOUT_CLIENT_ID!,
        "x-api-key": process.env.PAYOS_PAYOUT_API_KEY!,
        ...(body ? { "x-signature": signature(body) } : {}),
        ...(key ? { "x-idempotency-key": key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new PayoutError("NETWORK_UNKNOWN");
  }
  const result = await r.json().catch(() => null);
  if (!r.ok || result?.code !== "00")
    throw new PayoutError(
      String(result?.code || "HTTP_ERROR")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 60),
      r.status,
    );
  // Current payOS payouts SDK verifies x-signature response header, using payout canonicalization.
  const received = r.headers.get("x-signature");
  if (
    !received ||
    !/^[a-f0-9]{64}$/i.test(received) ||
    !timingSafeEqual(Buffer.from(signature(result.data), "hex"), Buffer.from(received, "hex"))
  )
    throw new PayoutError("INVALID_SIGNATURE");
  return result.data;
}
const infoSchema = z.object({
  id: z.string(),
  referenceId: z.string(),
  approvalState: z.string(),
  transactions: z.array(
    z.object({
      id: z.string(),
      referenceId: z.string(),
      amount: z.number().int().positive(),
      toBin: z.string(),
      toAccountNumber: z.string(),
      state: z.string(),
    }),
  ),
});
export type PayoutInfo = z.infer<typeof infoSchema>;
export type PayoutJob = {
  withdrawal_id: string;
  reference_id: string;
  idempotency_key: string;
  bank_code: string;
  bank_account_number: string;
  amount: number;
  fee: number;
  provider_id?: string | null;
  attempts: number;
};
export const payosPayoutAdapter = {
  async submit(j: PayoutJob): Promise<PayoutInfo> {
    return infoSchema.parse(
      await request(
        "/v1/payouts",
        {
          referenceId: j.reference_id,
          amount: j.amount - j.fee,
          description: "CVJ RUT",
          toBin: j.bank_code,
          toAccountNumber: j.bank_account_number,
        },
        j.idempotency_key,
      ),
    );
  },
  async find(j: PayoutJob): Promise<PayoutInfo | null> {
    if (j.provider_id)
      return infoSchema.parse(await request(`/v1/payouts/${encodeURIComponent(j.provider_id)}`));
    const data = await request(
      `/v1/payouts?limit=10&referenceId=${encodeURIComponent(j.reference_id)}`,
    );
    const matches = z
      .object({ payouts: z.array(infoSchema) })
      .parse(data)
      .payouts.filter((p) => p.referenceId === j.reference_id);
    if (matches.length > 1) throw new PayoutError("MULTIPLE_MATCHES");
    return matches[0] || null;
  },
};
export async function payoutAccess() {
  if (!payoutConfigured()) return "UNAVAILABLE";
  try {
    await request("/v1/payouts?limit=1");
    return "AVAILABLE";
  } catch (e) {
    return e instanceof PayoutError && [401, 403].includes(e.httpStatus)
      ? "UNAVAILABLE"
      : "UNVERIFIED";
  }
}
