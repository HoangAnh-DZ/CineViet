"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  UserRound,
  CirclePlay,
  History,
  Heart,
  Wallet,
  Crown,
  Coins,
  Bell,
  CircleHelp,
  Settings,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { ProfileHeading } from "@/components/navigation";
import { Modal } from "@/components/ui";
import { useApp } from "@/components/providers";
import { authService } from "@/services/client";
import { formatMoney } from "@/lib/format";
import { requestJson } from "@/services/client";
import type { LucideIcon } from "lucide-react";
export function ProfileMenuItem({
  Icon,
  label,
  href,
  onClick,
  notification = false,
}: {
  Icon: LucideIcon;
  label: string;
  href?: string;
  onClick?: () => void;
  notification?: boolean;
}) {
  const content = (
    <>
      <Icon
        size={19}
        strokeWidth={2}
        className={label === "Nâng cấp VIP" ? "crown-icon" : ""}
        aria-hidden="true"
      />
      <span>{label}</span>
      {notification ? <i className="notification-dot" /> : <ChevronRight size={14} />}
    </>
  );
  return href ? (
    <Link className="profile-menu-item" href={href}>
      {content}
    </Link>
  ) : (
    <button className="profile-menu-item" onClick={onClick}>
      {content}
    </button>
  );
}
export function ProfileScreen() {
  const { user, setUser, toast, balance } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const [panel, setPanel] = useState(params.get("panel") ?? "");
  const [name, setName] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  useEffect(() => {
    setName(user?.username || "");
    setEmail(user?.email || "");
  }, [user]);
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
      <ProfileHeading onSettings={() => setPanel("settings")} />
      <div className="content profile-content">
        <div className="profile-totals">
          <Link href="/wallet">
            <p>Ví của tôi</p>
            <strong>{formatMoney(balance.cash)}</strong>
          </Link>
          <Link href="/rewards">
            <p>Phần thưởng</p>
            <strong>Xu & điểm danh</strong>
          </Link>
        </div>
        <div className="profile-menu">
          <ProfileMenuItem
            Icon={UserRound}
            label="Thông tin cá nhân"
            onClick={() => setPanel("account")}
          />
          <ProfileMenuItem Icon={CirclePlay} label="Tiếp tục xem" href="/history" />
          <ProfileMenuItem Icon={History} label="Lịch sử xem" href="/history" />
          <ProfileMenuItem Icon={Heart} label="Phim yêu thích" href="/favorites" />
          <ProfileMenuItem Icon={Wallet} label="Ví của tôi" href="/wallet" />
          <ProfileMenuItem Icon={Crown} label="Nâng cấp VIP" href="/vip" />
          <ProfileMenuItem Icon={Coins} label="Lịch sử xu" href="/rewards?view=history" />
          <ProfileMenuItem
            Icon={Bell}
            label="Thông báo"
            onClick={() => setPanel("notifications")}
          />
          <ProfileMenuItem Icon={CircleHelp} label="Hỗ trợ" onClick={() => setPanel("support")} />
          <ProfileMenuItem Icon={Settings} label="Cài đặt" onClick={() => setPanel("settings")} />
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
              notifications: "Thông báo",
              support: "Hỗ trợ",
              settings: "Cài đặt",
              logout: "Đăng xuất",
            }[panel] ?? "Cá nhân"
          }
          onClose={() => setPanel("")}
        >
          {panel === "account" ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (user) {
                  try {
                    const result = await requestJson<{ user: typeof user }>("/api/account", {
                      method: "PATCH",
                      body: JSON.stringify({ display_name: name }),
                    });
                    setUser(result.user);
                    setPanel("");
                    toast("Đã lưu thông tin");
                  } catch (error) {
                    toast((error as Error).message);
                  }
                } else router.push("/login");
              }}
            >
              <label className="field-label" htmlFor="profile-name">
                Tên hiển thị
              </label>
              <input
                className="field"
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
              />
              <label className="field-label finance-section" htmlFor="profile-email">
                Email
              </label>
              <input
                className="field"
                id="profile-email"
                readOnly
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button className="button primary wide" type="submit">
                Lưu thông tin
              </button>
            </form>
          ) : panel === "notifications" ? (
            <>
              <h3>Chào mừng đến CINEMA</h3>
              <p>Chưa có thông báo mới.</p>
            </>
          ) : panel === "support" ? (
            <>
              <h3>Cần giúp đỡ?</h3>
              <p>
                Nếu video không phát, kiểm tra kết nối và tải lại trang. Thông tin liên hệ hỗ trợ sẽ
                được bổ sung khi dịch vụ ra mắt.
              </p>
            </>
          ) : panel === "settings" ? (
            <>
              <p>Ngôn ngữ: Tiếng Việt</p>
              <p>Giao diện: Tối</p>
              <button
                className="button secondary wide"
                onClick={() => {
                  setPanel("");
                  toast("Đã áp dụng cài đặt");
                }}
              >
                Lưu cài đặt
              </button>
            </>
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
