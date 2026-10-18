"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { MoneyConfig } from "@/server/money-config";
import { moneyStatus, type MoneyRequest } from "@/domain/money";
import { VipCheckout } from "./vip-checkout";
import { VipProductFacts } from "./vip-product-facts";
import { VipPurchaseHistory } from "./vip-purchase-history";
import { requestJson } from "@/services/client";
import "./vip-orders.css";
import "@/features/wallet/manual-money.css";
import { Check, Crown, MonitorPlay, Hd, CircleX } from "lucide-react";
import type { VipRewardPlan, Entitlement } from "@/domain/models";
import { formatMoney } from "@/lib/format";
import { PageHeader, Modal } from "@/components/ui";

const labels: Record<Entitlement, string> = {
  VIP_MOVIES: "Xem nội dung VIP",
  FULL_HD: "Chất lượng Full HD",
  NO_ADS: "Không quảng cáo",
  VIP_BADGE: "Huy hiệu VIP",
  EARLY_ACCESS: "Ưu tiên nội dung mới",
};
export function VipPlanCard({
  plan,
  onSelect,
  current = false,
  purchased = false,
  pending = false,
}: {
  plan: VipRewardPlan;
  onSelect: () => void;
  current?: boolean;
  purchased?: boolean;
  pending?: boolean;
}) {
  return (
    <div className={`vip-plan ${plan.tier === "VIP_3" ? "recommended" : ""}`}>
      <h3>{plan.name}</h3>
      {current ? <span className="vip-current-badge">Đang sử dụng</span> : null}
      <div className="vip-price">{formatMoney(plan.price)}</div>
      <VipProductFacts plan={plan} />
      <ul>
        {plan.benefits
          .filter((benefit) => benefit !== "EARLY_ACCESS")
          .map((benefit) => (
            <li key={benefit}>
              <Check size={15} />
              <span>{labels[benefit]}</span>
            </li>
          ))}
      </ul>
      <button
        className="button primary"
        disabled={plan.price === 0 || purchased}
        onClick={onSelect}
      >
        {plan.price === 0
          ? "Gói cơ bản"
          : purchased
            ? "Đã mua gói này"
            : pending
              ? `Tiếp tục ${plan.name}`
              : `Chọn gói ${plan.name}`}
      </button>
    </div>
  );
}
export function VipScreen({
  plans: vipPlans,
  membershipName,
  config,
  signedIn,
  initialRequests,
  initialPurchased,
}: {
  plans: VipRewardPlan[];
  membershipName: string;
  config: MoneyConfig;
  signedIn: boolean;
  initialRequests: MoneyRequest[];
  initialPurchased: string[];
}) {
  const [selected, setSelected] = useState<VipRewardPlan | null>(null);
  const [paymentStage, setPaymentStage] = useState(false);
  const [busy, setBusy] = useState(false),
    [requests, setRequests] = useState(initialRequests),
    [success, setSuccess] = useState("");
  const router = useRouter();
  const [purchased, setPurchased] = useState(initialPurchased),
    [error, setError] = useState("");
  useEffect(() => setRequests(initialRequests), [initialRequests]);
  useEffect(() => setPurchased(initialPurchased), [initialPurchased]);
  const refreshOrders = useCallback(async () => {
    try {
      const state = await requestJson<{ requests: MoneyRequest[]; purchased: string[] }>(
        "/api/vip/purchases?view=state",
      );
      setRequests(state.requests);
      setPurchased(state.purchased);
      setError("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được lệnh nâng cấp.");
    }
  }, [router]);
  useEffect(() => {
    if (!signedIn) return;
    const update = () => {
      if (document.visibilityState === "visible") void refreshOrders();
    };
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [signedIn, refreshOrders]);
  return (
    <>
      <PageHeader title="Nâng cấp VIP" />
      <div className="content vip-content">
        {success ? (
          <p className="money-success" role="status">
            {success}
          </p>
        ) : null}
        <div className="current-plan">
          <span className="plan-icon">
            <Crown size={28} />
          </span>
          <div>
            <p>Tài khoản hiện tại</p>
            <h2>{membershipName}</h2>
          </div>
        </div>
        <p className="vip-purchase-rule">
          Mỗi tài khoản chỉ được mua thành công mỗi gói VIP một lần.
        </p>
        <div className="vip-plans">
          {vipPlans
            .filter((plan) => plan.price > 0)
            .map((plan) => (
              <VipPlanCard
                key={plan.id}
                plan={plan}
                current={plan.name === membershipName}
                purchased={purchased.includes(plan.id)}
                pending={requests.some((r) => r.plan_id === plan.id && r.status === "PENDING")}
                onSelect={() => {
                  setPaymentStage(false);
                  setSelected(plan);
                }}
              />
            ))}
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <h2>Quyền lợi VIP</h2>
        <div className="benefits-grid">
          {[
            { Icon: MonitorPlay, text: "Xem nội dung VIP" },
            { Icon: Hd, text: "Chất lượng Full HD" },
            { Icon: CircleX, text: "Không quảng cáo" },
          ].map(({ Icon, text }) => (
            <div className="benefit" key={text}>
              <span>
                <Icon size={22} strokeWidth={1.5} />
              </span>
              {text}
            </div>
          ))}
        </div>
        {signedIn ? <VipPurchaseHistory requests={requests} onRefresh={refreshOrders} /> : null}
      </div>
      {selected ? (
        <Modal
          title={paymentStage ? "Thông tin thanh toán" : "Thông tin gói VIP"}
          className="vip-checkout-modal"
          onClose={() => {
            if (!busy) {
              setSelected(null);
              if (signedIn) void refreshOrders();
            }
          }}
        >
          <VipCheckout
            key={selected.id}
            plan={selected}
            config={config}
            signedIn={signedIn}
            onBusy={setBusy}
            onBack={() => {
              if (!busy) {
                setSelected(null);
                if (signedIn) void refreshOrders();
              }
            }}
            onStageChange={setPaymentStage}
            onPaid={() => {
              setSuccess("Thanh toán thành công · VIP đã được kích hoạt");
              void refreshOrders();
            }}
          />
        </Modal>
      ) : null}
    </>
  );
}
