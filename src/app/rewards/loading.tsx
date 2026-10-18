import { Skeleton } from "@/components/ui";
export default function Loading() {
  return (
    <div
      className="rewards-content rewards-loading"
      role="status"
      aria-label="Đang tải phần thưởng"
    >
      <Skeleton className="skeleton-title" />
      <Skeleton className="reward-skeleton-balance" />
      <Skeleton className="reward-skeleton-checkin" />
      <Skeleton className="reward-skeleton-mission" />
      <Skeleton className="reward-skeleton-mission" />
    </div>
  );
}
