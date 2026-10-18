"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  UserRound,
  History,
  Crown,
  Coins,
  CircleHelp,
  Settings,
  LogOut,
  ChevronRight,
  Gift,
  Download,
  Bookmark,
  MonitorSmartphone,
} from "lucide-react";
import { ProfileHeading } from "@/components/navigation";
import { Modal } from "@/components/ui";
import { useApp } from "@/components/providers";
import { authService } from "@/services/client";
import { formatMoney } from "@/lib/format";
import { AccountSettings } from "./account-settings";
import type { LucideIcon } from "lucide-react";
import type { User } from "@/domain/models";
export function ProfileMenuItem({
  Icon,
  label,
  href,
  onClick,
  notification = false,
  disabled = false,
}: {
  Icon: LucideIcon;
  label: string;
  href?: string;
  onClick?: () => void;
  notification?: boolean;
  disabled?: boolean;
}) {
  const content = (
    <>
      <Icon
        size={19}
        strokeWidth={2}
        className={label === "Nâng cấp VIP" ? "crown-icon" : ""}
        aria-hidden="true"
      />
      <span>
        {label}
        {disabled ? <small className="menu-coming-soon">Sắp ra mắt</small> : null}
      </span>
      {notification ? <i className="notification-dot" /> : <ChevronRight size={14} />}
    </>
  );
  return href?.startsWith("https://") ? (
    <a className="profile-menu-item" href={href} target="_blank" rel="noopener noreferrer">
      {content}
    </a>
  ) : href ? (
    <Link className="profile-menu-item" href={href}>
      {content}
    </Link>
  ) : (
    <button className="profile-menu-item" onClick={onClick} disabled={disabled}>
      {content}
    </button>
  );
}
export function ProfileScreen({
  membership,
  initialUser,
  referral,
}: {
  initialUser: User;
  membership: { name: string; expires_at: string } | null;
  referral: { code: string; referred: number; earned: number; percent: number };
}) {
  const { user, setUser, toast } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const requestedPanel = params.get("panel") || "";
  const [panel, setPanel] = useState(
    ["account", "settings", "logout"].includes(requestedPanel) ? requestedPanel : "",
  );
  async function logout() {
    try {
      await authService.signOut();
      setUser(null);
      router.push("/login");
      router.refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <>
      <ProfileHeading
        initialUser={initialUser}
        membershipName={membership?.name || null}
        onSettings={() => setPanel("settings")}
      />
      <div className="content profile-content">
        <section className="profile-vip-card">
          <span className="vip-emblem">
            <Crown size={26} />
          </span>
          <div>
            <h2>{membership?.name || "Nâng cấp VIP"}</h2>
            <p>
              {membership
                ? `Có hiệu lực đến ${new Date(membership.expires_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`
                : "Xem nội dung VIP · Full HD · Không quảng cáo"}
            </p>
            <Link href="/vip" className="button primary small">
              {membership ? "Xem quyền lợi" : "Nâng cấp"}
              <ChevronRight size={16} />
            </Link>
          </div>
        </section>
        <Link href="/referrals" className="profile-wallet-card referral-card">
          <div className="section-heading">
            <h2>
              <Gift size={20} /> Giới thiệu bạn bè
            </h2>
            <ChevronRight size={20} />
          </div>

          <div className="profile-wallet-values">
            <div>
              <p>Mã giới thiệu</p>
              <strong>{referral.code}</strong>
            </div>
            <div>
              <p>Đã nhận</p>
              <strong>{formatMoney(referral.earned)}</strong>
            </div>
          </div>
          <small className="helper">Đã giới thiệu: {referral.referred} người</small>
        </Link>
        <section className="profile-menu-group">
          <h2>Không gian của bạn</h2>
          <div className="profile-menu">
            <ProfileMenuItem Icon={Bookmark} label="Danh sách của tôi" href="/list" />
            <ProfileMenuItem Icon={History} label="Lịch sử xem" href="/history" />
            <ProfileMenuItem Icon={Gift} label="Đổi thưởng" href="/rewards/redeem" />
            <ProfileMenuItem Icon={Coins} label="Lịch sử xu" href="/rewards?view=history" />
          </div>
        </section>
        <section className="profile-menu-group profile-account-group">
          <h2>Tài khoản & hỗ trợ</h2>
          <div className="profile-menu">
            <ProfileMenuItem
              Icon={UserRound}
              label="Thông tin cá nhân"
              onClick={() => setPanel("account")}
            />
            <ProfileMenuItem Icon={MonitorSmartphone} label="Thiết bị" disabled />
            <ProfileMenuItem Icon={Settings} label="Cài đặt" onClick={() => setPanel("settings")} />
            <ProfileMenuItem Icon={CircleHelp} label="Hỗ trợ" href="https://t.me/JameCine" />
            <ProfileMenuItem Icon={Download} label="Tải xuống ngoại tuyến" disabled />
          </div>
        </section>
        <div className="profile-signout">
          <ProfileMenuItem
            Icon={LogOut}
            label={user ? "Đăng xuất" : "Đăng nhập"}
            onClick={() => (user ? setPanel("logout") : router.push("/login"))}
          />
        </div>
      </div>
      {panel ? (
        <Modal
          title={
            {
              account: "Thông tin cá nhân",
              settings: "Cài đặt",
              logout: "Đăng xuất",
            }[panel] ?? "Cá nhân"
          }
          onClose={() => setPanel("")}
        >
          {panel === "account" || panel === "settings" ? (
            <AccountSettings initialUser={user || initialUser} onUser={setUser} />
          ) : panel === "logout" ? (
            <>
              <p>Bạn muốn đăng xuất?</p>
              <button className="button primary wide" onClick={logout}>
                Đăng xuất
              </button>
            </>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
