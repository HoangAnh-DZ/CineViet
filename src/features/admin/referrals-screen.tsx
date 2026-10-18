import { Users, Percent, WalletCards } from "lucide-react";
import { DashboardHeading } from "./dashboard-screen";
import { formatMoney } from "@/lib/format";

export interface ReferralAdminData {
  total: number;
  earned: number;
  referrers: Array<{ email: string; display_name: string; referred: number; earned: number }>;
}

export function ReferralsScreen({ data }: { data: ReferralAdminData }) {
  return (
    <>
      <DashboardHeading
        title="Giới thiệu / hoa hồng"
        description="Theo dõi lượt giới thiệu và hoa hồng 10% đã phát sinh khi mua VIP được duyệt."
      />
      <div className="dashboard-metrics">
        {[
          ["Lượt giới thiệu", data.total.toLocaleString("vi-VN"), Users],
          ["Hoa hồng đã trả", formatMoney(data.earned), WalletCards],
          ["Tỷ lệ áp dụng", "10%", Percent],
        ].map(([label, value, Icon]) => (
          <article className="dashboard-metric" key={String(label)}>
            <div><span>{String(label)}</span><Icon size={18} /></div>
            <strong>{String(value)}</strong>
            <small>Dữ liệu giao dịch đã được duyệt</small>
          </article>
        ))}
      </div>
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading">
          <div><h2>Top người giới thiệu</h2><p>Sắp xếp theo hoa hồng đã phát</p></div>
        </div>
        <div className="dashboard-table-wrap">
          <table className="dashboard-table">
            <thead><tr><th>Thành viên</th><th>Lượt giới thiệu</th><th>Hoa hồng</th></tr></thead>
            <tbody>
              {data.referrers.map((item) => (
                <tr key={item.email}>
                  <td><strong>{item.display_name}</strong><small>{item.email}</small></td>
                  <td>{item.referred}</td>
                  <td className="positive">{formatMoney(item.earned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.referrers.length ? <div className="dashboard-empty"><p>Chưa có hoa hồng phát sinh</p></div> : null}
        </div>
      </section>
    </>
  );
}
