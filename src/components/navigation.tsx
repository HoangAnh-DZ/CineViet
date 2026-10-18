"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  SquarePlay,
  Gift,
  Bookmark,
  CircleUserRound,
  Search,
  Settings,
} from "lucide-react";
import { useApp } from "./providers";
import { mainTabs, activeMainTab } from "@/domain/navigation";
import Image from "next/image";
import type { User } from "@/domain/models";
import { BrandLogo } from "./brand-logo";
export function Brand({ vertical = false }: { vertical?: boolean }) {
  return (
    <Link
      href="/explore"
      className={`brand ${vertical ? "vertical" : ""}`}
      aria-label="CineVjet · Khám phá"
    >
      <BrandLogo variant={vertical ? "full" : "compact"} priority />
    </Link>
  );
}
export function Avatar({ large = false, account }: { large?: boolean; account?: User }) {
  const { user } = useApp();
  const current = account || user;
  return (
    <div className={`avatar ${large ? "large" : ""}`}>
      {current?.avatar ? (
        <Image
          src={current.avatar}
          alt="Ảnh đại diện"
          width={large ? 64 : 32}
          height={large ? 64 : 32}
          unoptimized={current.avatar.startsWith("https://")}
        />
      ) : (
        <span aria-label={`Ảnh đại diện ${current?.username || "CineVjet"}`}>
          {(current?.username || "C").slice(0, 1).toUpperCase()}
        </span>
      )}
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
        <Link href="/profile" className="icon-button" aria-label="Của tôi">
          <Avatar />
        </Link>
      </div>
    </header>
  );
}
const tabIcons = [Compass, SquarePlay, Gift, Bookmark, CircleUserRound];
export function BottomNavigation() {
  const pathname = usePathname();
  if (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/wallet/deposit" ||
    pathname === "/wallet/withdraw"
  )
    return null;
  return (
    <nav className="bottom-nav" aria-label="Điều hướng chính">
      <div className="desktop-nav-brand">
        <Brand />
      </div>
      <div className="main-nav-tabs">
        {mainTabs.map(({ href, label }, index) => {
          const Icon = tabIcons[index];
          const active = activeMainTab(pathname) === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`nav-tab nav-tab-${index} ${active ? "active" : ""}`}
            >
              <span className="nav-icon">
                <Icon
                  size={24}
                  strokeWidth={active ? 2.4 : 2}
                  fill={active && (index === 2 || index === 3) ? "currentColor" : "none"}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                />
              </span>
              <span className="nav-label">{label}</span>
            </Link>
          );
        })}
      </div>
      <Link href="/search" className="desktop-nav-search" aria-label="Tìm kiếm phim">
        <Search size={20} />
        <span>Tìm phim</span>
      </Link>
    </nav>
  );
}
export function ProfileHeading({
  onSettings,
  initialUser,
  membershipName,
}: {
  onSettings?: () => void;
  initialUser?: User;
  membershipName?: string | null;
}) {
  const { user, entitlements } = useApp();
  const displayUser = user || initialUser;
  return (
    <div className="profile-heading">
      <div className="section-heading">
        <h1>Của tôi</h1>
        <button className="icon-button" aria-label="Cài đặt" onClick={onSettings}>
          <Settings size={20} />
        </button>
      </div>
      <div className="profile-info">
        <Avatar large account={displayUser} />
        <div>
          <h2>{displayUser?.username ?? "Khách"}</h2>
          <p>{displayUser?.email ?? "Đăng nhập để lưu phim yêu thích"}</p>
          <small>ID: {displayUser?.id.slice(0, 8)}</small>
        </div>
        <span className="membership">
          {(membershipName === undefined ? entitlements.includes("VIP_BADGE") : !!membershipName)
            ? "VIP"
            : "FREE"}
        </span>
      </div>
    </div>
  );
}
