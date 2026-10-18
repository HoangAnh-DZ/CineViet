import { requireAdmin } from "@/server/admin";
import { checkOrigin, readBody, json, failure, ApiError } from "@/server/http";
import { adminMoneyDetail, approveDepositRequest, completeWithdrawal } from "@/server/manual-money";
import type { MoneyKind } from "@/domain/money";
import { approveVipPurchase } from "@/server/vip-purchases";
async function target(params: Promise<{ kind: string; id: string }>) {
  const p = await params;
  if (!["DEPOSIT", "WITHDRAWAL", "VIP_PURCHASE"].includes(p.kind) || p.id.length > 100)
    throw new ApiError(400, "Yêu cầu không hợp lệ.");
  return { ...p, kind: p.kind as MoneyKind };
}
export async function GET(
  _: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  try {
    const user = await requireAdmin(),
      p = await target(params);
    return json(await adminMoneyDetail(user.id, p.kind, p.id));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  try {
    checkOrigin(request);
    const user = await requireAdmin(),
      p = await target(params),
      body = await readBody(request);
    return json(
      await (
        p.kind === "VIP_PURCHASE"
          ? approveVipPurchase
          : p.kind === "DEPOSIT"
            ? approveDepositRequest
            : completeWithdrawal
      )(user.id, p.id, body),
    );
  } catch (e) {
    return failure(e);
  }
}
