import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ApiError } from "./http";
import { configuredSiteOrigin } from "@/lib/site";

export function payosConfigured() {
  return !!(
    process.env.PAYOS_CLIENT_ID &&
    process.env.PAYOS_API_KEY &&
    process.env.PAYOS_CHECKSUM_KEY
  );
}
function credentials() {
  if (!payosConfigured()) throw new ApiError(503, "Thanh toán payOS chưa được cấu hình.");
  return {
    client: process.env.PAYOS_CLIENT_ID!,
    api: process.env.PAYOS_API_KEY!,
    checksum: process.env.PAYOS_CHECKSUM_KEY!,
  };
}
// payOS's documented canonical form; not URL-encoded. Undefined fields are omitted.
export function canonicalData(data: Record<string, unknown>): string {
  return Object.keys(data)
    .sort()
    .filter((k) => data[k] !== undefined)
    .map((k) => {
      let v = data[k];
      if (Array.isArray(v))
        v = JSON.stringify(
          v.map((item) =>
            item && typeof item === "object"
              ? Object.fromEntries(
                  Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
                )
              : item,
          ),
        );
      if (v === null || v === "null" || v === "undefined") v = "";
      return `${k}=${v}`;
    })
    .join("&");
}
export function signData(data: Record<string, unknown>) {
  return createHmac("sha256", credentials().checksum).update(canonicalData(data)).digest("hex");
}
export function verifySignature(data: Record<string, unknown>, signature: unknown) {
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature))
    throw new ApiError(401, "Chữ ký payOS không hợp lệ.");
  if (!timingSafeEqual(Buffer.from(signData(data), "hex"), Buffer.from(signature, "hex")))
    throw new ApiError(401, "Chữ ký payOS không hợp lệ.");
}
export class PayosApiError extends ApiError {
  constructor(
    public providerCode: string,
    public httpStatus: number,
    public paymentNotFound = false,
  ) {
    super(
      503,
      "Chưa xác nhận được thanh toán với payOS. Thử lại để kiểm tra cùng đơn hoặc mở lịch sử; không tạo đơn mới.",
    );
  }
}
export async function payosRequest(
  path: string,
  method = "GET",
  body?: unknown,
  extra?: Record<string, string>,
) {
  const c = credentials();
  function providerError(code: string, status: number, description?: unknown) {
    const paymentNotFound =
      method === "GET" &&
      /^\/v2\/payment-requests\/\d+$/.test(path) &&
      status === 200 &&
      code === "101" &&
      description === "Mã thanh toán không tồn tại";
    // Never log credentials, signatures, provider payloads or bank details.
    (paymentNotFound ? console.info : console.warn)("payOS request result", {
      operation: method === "POST" ? "CREATE_OR_CONFIGURE" : "LOOKUP",
      providerCode: code,
      httpStatus: status,
      reason: paymentNotFound ? "PAYMENT_NOT_FOUND" : "PROVIDER_ERROR",
      configured: {
        clientId: !!process.env.PAYOS_CLIENT_ID,
        apiKey: !!process.env.PAYOS_API_KEY,
        checksumKey: !!process.env.PAYOS_CHECKSUM_KEY,
      },
    });
    return new PayosApiError(code, status, paymentNotFound);
  }
  let response: Response;
  try {
    response = await fetch(`https://api-merchant.payos.vn${path}`, {
      method,
      headers: {
        "x-client-id": c.client,
        "x-api-key": c.api,
        "Content-Type": "application/json",
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw providerError("NETWORK_UNKNOWN", 0);
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw providerError("INVALID_RESPONSE", response.status);
  }
  if (!response.ok || result.code !== "00")
    throw providerError(String(result.code || "HTTP_ERROR"), response.status, result.desc);
  if (!result.data || typeof result.data !== "object")
    throw providerError("INVALID_RESPONSE", response.status);
  return result as { data: Record<string, unknown>; signature?: string };
}
export const paymentInfoSchema = z
  .object({
    id: z.string().min(1).optional(),
    paymentLinkId: z.string().min(1).optional(),
    orderCode: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    amount: z.number().int().positive(),
    amountPaid: z.number().int().nonnegative().optional(),
    amountRemaining: z.number().int().nonnegative().optional(),
    status: z.enum([
      "PENDING",
      "UNDERPAID",
      "PROCESSING",
      "PAID",
      "CANCELLED",
      "EXPIRED",
      "FAILED",
    ]),
    currency: z.literal("VND").optional(),
    checkoutUrl: z.string().optional(),
    qrCode: z.string().optional(),
    accountNumber: z.string().optional(),
    accountName: z.string().optional(),
    bin: z.string().optional(),
  })
  .passthrough();
export async function getPaymentInfo(orderCode: number) {
  const r = await payosRequest(`/v2/payment-requests/${orderCode}`);
  verifySignature(r.data, r.signature);
  return paymentInfoSchema.parse(r.data);
}
export async function cancelPaymentLink(orderCode: number) {
  const r = await payosRequest(`/v2/payment-requests/${orderCode}/cancel`, "POST", {
    cancellationReason: "User requested VIP cancellation",
  });
  verifySignature(r.data, r.signature);
  return paymentInfoSchema.parse(r.data);
}
export async function createPaymentLink(data: {
  orderCode: number;
  amount: number;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  expiredAt: number;
}) {
  const { amount, cancelUrl, description, orderCode, returnUrl } = data;
  const r = await payosRequest("/v2/payment-requests", "POST", {
    ...data,
    signature: signData({ amount, cancelUrl, description, orderCode, returnUrl }),
  });
  verifySignature(r.data, r.signature);
  return paymentInfoSchema.parse(r.data);
}
export async function confirmWebhook() {
  const webhookUrl = `${paymentOrigin()}/api/payments/payos/webhook`;
  const r = await payosRequest("/confirm-webhook", "POST", { webhookUrl });
  if (r.data.webhookUrl !== webhookUrl)
    throw new ApiError(503, "Chưa xác nhận được webhook payOS.");
  return { registered: true, webhookUrl };
}
export function paymentOrigin() {
  const url = new URL(configuredSiteOrigin());
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
    throw new ApiError(503, "URL thanh toán chưa hợp lệ.");
  return url.origin;
}
