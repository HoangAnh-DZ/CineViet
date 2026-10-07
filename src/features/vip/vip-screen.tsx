"use client";
import { useState } from "react";
import { Check, Crown, MonitorPlay, Hd, CircleX, Rocket } from "lucide-react";
import type { VipPlan, Entitlement } from "@/domain/models";
import { formatMoney } from "@/lib/format";
import { useApp } from "@/components/providers";
import { PageHeader, Modal } from "@/components/ui";

const labels: Record<Entitlement, string> = {
  VIP_MOVIES: "Xem nội dung VIP",
  FULL_HD: "Chất lượng Full HD",
  NO_ADS: "Không quảng cáo",
  VIP_BADGE: "Badge VIP",
  EARLY_ACCESS: "Ưu tiên nội dung mới",
};
export function VipPlanCard({ plan, onSelect }: { plan: VipPlan; onSelect: () => void }) {
  return (
    <div className={`vip-plan ${plan.id === "VIP_YEARLY" ? "recommended" : ""}`}>
      <h3>{plan.name}</h3>
      <div className="vip-price">{formatMoney(plan.price)}</div>
      <div className="vip-discount">Tiết kiệm {plan.discount}%</div>
      <ul>
        {plan.benefits.map((benefit) => (
          <li key={benefit}>
            <Check size={12} />
            <span>{labels[benefit]}</span>
          </li>
        ))}
      </ul>
      <button className="button primary" onClick={onSelect}>
        Nâng cấp ngay
      </button>
    </div>
  );
}
export function VipScreen({ plans: vipPlans }: { plans: VipPlan[] }) {
  const [selected, setSelected] = useState<VipPlan | null>(null);
  const { entitlements } = useApp();
  return (
    <>
      <PageHeader title="Nâng cấp VIP" />
      <div className="content vip-content">
        <p className="vip-subtitle">Tận hưởng trải nghiệm xem phim tốt hơn.</p>
        <div className="current-plan">
          <span className="plan-icon">
            <Crown size={28} />
          </span>
          <div>
            <p>Tài khoản hiện tại</p>
            <h2>{entitlements.includes("VIP_MOVIES") ? "VIP" : "Free"}</h2>
          </div>
        </div>
        <div className="vip-plans">
          {vipPlans
            .filter((p) => p.price > 0)
            .map((plan) => (
              <VipPlanCard
                key={plan.id}
                plan={plan}
                onSelect={() => {
                  setSelected(plan);
                }}
              />
            ))}
        </div>
        <h2>Quyền lợi VIP</h2>
        <div className="benefits-grid">
          {[
            { Icon: MonitorPlay, text: "Xem nội dung VIP" },
            { Icon: Hd, text: "Chất lượng Full HD" },
            { Icon: CircleX, text: "Không quảng cáo" },
            { Icon: Rocket, text: "Ưu tiên nội dung mới" },
          ].map(({ Icon, text }) => (
            <div className="benefit" key={text}>
              <span>
                <Icon size={22} strokeWidth={1.5} />
              </span>
              {text}
            </div>
          ))}
        </div>
      </div>
      {selected ? (
        <Modal title={"Nâng cấp VIP · " + selected.name} onClose={() => setSelected(null)}>
          <div className="quote">
            <div>
              <span>Thời hạn</span>
              <strong>{selected.duration_days} ngày</strong>
            </div>
            <div>
              <span>Giá gói</span>
              <strong>{formatMoney(selected.price)}</strong>
            </div>
          </div>
          <p>Thanh toán VIP đang hoàn thiện.</p>
          <button className="button primary wide" disabled>
            Đang hoàn thiện
          </button>
        </Modal>
      ) : null}
    </>
  );
}
