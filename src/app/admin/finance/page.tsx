import { protectAdminPage } from "@/server/admin";
import {
  dashboardOverview,
  moneyTransactions,
  withdrawalTransactions,
  type WithdrawalFilters,
} from "@/server/dashboard";
import { FinanceScreen } from "@/features/admin/dashboard-screen";
import { WithdrawalRequests } from "@/features/admin/withdrawal-requests";
import type { MoneyKind } from "@/domain/money";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Dòng tiền" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; id?: string; view?: string } & WithdrawalFilters>;
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
  const [data, transactions] = await Promise.all([
    dashboardOverview(u.id),
    moneyTransactions(u.id),
  ]);
  const initialFilter =
    query.view === "deposits" ? "INCOMING" : query.view === "withdrawals" ? "WITHDRAWAL" : "ALL";
  return (
    <FinanceScreen
      data={data}
      transactions={transactions}
      initialReview={initialReview}
      initialFilter={initialFilter}
    />
  );
}
