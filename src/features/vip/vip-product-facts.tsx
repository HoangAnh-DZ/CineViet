import type { VipRewardPlan } from "@/domain/models";
export function VipProductFacts({
  plan,
}: {
  plan: Pick<VipRewardPlan, "duration_days" | "mission_count" | "total_videos" | "mission_reward">;
}) {
  return (
    <dl className="vip-product-facts">
      {[
        ["Thời hạn", `${plan.duration_days} ngày`],
        ["Video mỗi ngày", String(plan.mission_count)],
        ["Tổng video", String(plan.total_videos)],
        ["Xu/video", `${plan.mission_reward.toLocaleString("vi-VN")} xu`],
      ].map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
