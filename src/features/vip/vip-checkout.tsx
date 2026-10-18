"use client";
import Link from "next/link";
import type { VipRewardPlan } from "@/domain/models";
import type { MoneyConfig } from "@/server/money-config";
import { VipPayosCheckout } from "./vip-payos-checkout";
import { VipProductFacts } from "./vip-product-facts";
import { formatMoney } from "@/lib/format";
import "./vip-bank-checkout.css";
export function VipCheckout({
  plan,
  config,
  signedIn,
  onBusy,
  onBack,
  onStageChange,
  onPaid,
}: {
  plan: VipRewardPlan;
  config: MoneyConfig;
  signedIn: boolean;
  onBusy: (busy: boolean) => void;
  onBack?: () => void;
  onStageChange?: (payment: boolean) => void;
  onPaid?: () => void;
}) {
  if (!signedIn)
    return (
      <div className="vip-confirmation">
        <div className="vip-confirm-plan">
          <h3>{plan.name}</h3>
          <strong>{formatMoney(plan.price)}</strong>
        </div>
        <VipProductFacts plan={plan} />
        <p className="helper">1 xu = 1 VNĐ</p>
        <div className="vip-confirm-method">Chuyển khoản ngân hàng</div>
        <Link className="button primary wide" href="/login?next=%2Fvip">
          Đăng nhập để tiếp tục
        </Link>
      </div>
    );
  return (
    <VipPayosCheckout
      plan={plan}
      disabled={!config.deposit_enabled}
      onBusy={onBusy}
      onBack={onBack}
      onStageChange={onStageChange}
      onPaid={onPaid}
    />
  );
}
