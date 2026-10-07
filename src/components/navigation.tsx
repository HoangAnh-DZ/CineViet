"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House,
  Compass,
  Gift,
  WalletMinimal,
  UserRound,
  Search,
  Play,
  Settings,
} from "lucide-react";
import { useApp } from "./providers";
export function Brand({ vertical = false }: { vertical?: boolean }) {
  return (
    <Link href="/" className={`brand ${vertical ? "vertical" : ""}`} aria-label="Cinema Home">
      <span className="brand-mark">
        <Play size={18} fill="currentColor" />
      </span>
      <span>
        CIN<span className="brand-e">E</span>MA
      </span>
    </Link>
  );
}
export function Avatar({ large = false }: { large?: boolean }) {
  return (
    <div className={`avatar ${large ? "large" : ""}`}>
      <img src="/images/avatar.webp" alt="Ảnh đại diện" />
    </div>
  );
}
export function AppHeader() {
  return (
    <header className="app-header">
      <Brand />
      <div className="header-links">
        <Link href="/search" className="icon-button" aria-label="Tìm kiếm">
          <Search size={22} />
        </Link>
        <Link href="/profile" aria-label="Cá nhân">
          <Avatar />
        </Link>
      </div>
    </header>
  );
}
const tabs = [
  { href: "/", label: "Home", icon: House },
  { href: "/explore", label: "Khám phá", icon: Compass },
  { href: "/rewards", label: "Phần thưởng", icon: Gift },
  { href: "/wallet", label: "Ví", icon: WalletMinimal },
  { href: "/profile", label: "Cá nhân", icon: UserRound },
];
export function BottomNavigation() {
  const pathname = usePathname();
  if (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/wallet/deposit" ||
    pathname === "/wallet/withdraw"
  )
    return null;
  return (
    <nav className="bottom-nav" aria-label="Điều hướng chính">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/"
            ? pathname === "/"
            : pathname.startsWith(href) || (href === "/explore" && pathname === "/search");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={active ? "active" : ""}
          >
            <Icon
              size={24}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
export function ProfileHeading({ onSettings }: { onSettings?: () => void }) {
  const { user, entitlements } = useApp();
  return (
    <div className="profile-heading">
      <div className="section-heading">
        <h1>Cá nhân</h1>
        <button className="icon-button" aria-label="Cài đặt" onClick={onSettings}>
          <Settings size={20} />
        </button>
      </div>
      <div className="profile-info">
        <Avatar large />
        <div>
          <h2>{user?.username ?? "Khách"}</h2>
          <p>{user?.email ?? "Đăng nhập để lưu phim yêu thích"}</p>
          <small>ID: {user?.id.slice(0, 8)}</small>
        </div>
        <span className="membership">{entitlements.includes("VIP_BADGE") ? "VIP" : "FREE"}</span>
      </div>
    </div>
  );
}
