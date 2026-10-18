import { protectAdminPage } from "@/server/admin";
import {
  dashboardOverview,
  withdrawalTransactions,
  type WithdrawalFilters,
} from "@/server/dashboard";
import { FinanceScreen } from "@/features/admin/dashboard-screen";
import { WithdrawalRequests } from "@/features/admin/withdrawal-requests";
import type { MoneyKind } from "@/domain/money";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Tổng quan" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<
    { mode?: string; view?: string; kind?: string; id?: string } & WithdrawalFilters
  >;
}) {
  const u = await protectAdminPage();
  const query = await searchParams;
  const initialReview: { kind: MoneyKind; id: string } | null =
    (query.kind === "DEPOSIT" || query.kind === "WITHDRAWAL" || query.kind === "VIP_PURCHASE") &&
    query.id &&
    query.id.length <= 100
      ? { kind: query.kind, id: query.id }
      : null;
  if (query.view === "withdrawals")
    return (
      <WithdrawalRequests
        data={await withdrawalTransactions(u.id, query)}
        initialReview={initialReview}
      />
    );
  const data = await dashboardOverview(
    u.id,
    query.view === "deposits" || query.mode === "ALL" ? "ALL" : "BUSINESS",
    true,
  );
  return (
    <FinanceScreen
      data={data}
      transactions={data.transactions}
      initialReview={initialReview}
      initialFilter={query.view === "deposits" ? "INCOMING" : "ALL"}
    />
  );
}
