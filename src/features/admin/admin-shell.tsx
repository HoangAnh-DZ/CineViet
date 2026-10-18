"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Clapperboard,
  ArrowLeftRight,
  Users,
  Gift,
  ArrowUpRight,
  ShieldCheck,
  Menu,
  X,
  Settings,
  Banknote,
  Package,
  Percent,
  Sun,
  Moon,
  ChevronRight,
} from "lucide-react";
import { useEffect, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
const links = [
  { href: "/admin", label: "Tổng quan", description: "Số liệu toàn hệ thống", Icon: LayoutDashboard },
  { href: "/admin/users", label: "Người dùng", description: "Thành viên và tuyến giới thiệu", Icon: Users },
  { href: "/admin/finance?view=economy", label: "Kinh tế", description: "Doanh thu và lợi nhuận", Icon: ArrowLeftRight },
  { href: "/admin/finance?view=deposits", label: "Nạp tiền", description: "Lệnh nạp và tiền vào", Icon: Banknote },
  { href: "/admin/finance?view=withdrawals", label: "Rút tiền", description: "Lệnh rút và tiền ra", Icon: ArrowUpRight },
  { href: "/admin/referrals", label: "Giới thiệu / hoa hồng", description: "Cấp trên, cấp dưới, thưởng", Icon: Percent },
  { href: "/admin/videos", label: "Quản lý video", description: "Phim, tập và nguồn phát", Icon: Clapperboard },
  { href: "/admin/shorts", label: "Phim ngắn", description: "Nguồn và lịch xuất bản", Icon: Clapperboard },
  { href: "/admin/plans", label: "Quản lý gói VIP", description: "Giá, thời hạn, nhiệm vụ", Icon: Package },
  { href: "/admin/rewards", label: "Mã đổi thưởng", description: "Tạo và theo dõi mã", Icon: Gift },
  { href: "/admin/settings", label: "Cấu hình hệ thống", description: "Nạp, rút và bảo trì", Icon: Settings },
];
export function AdminShell({ children, name }: { children: React.ReactNode; name: string }) {
  const path = usePathname(),
    searchParams = useSearchParams(),
    view = searchParams.get("view"),
    [open, setOpen] = useState(false),
    [theme, setTheme] = useState<"dark" | "light">("light");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("cinevjet-admin-theme-v2");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch { /* The default theme remains usable when storage is unavailable. */ }
  }, []);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const activeLink = links.find(({ href }) => {
    const [basePath, query] = href.split("?");
    return (path === basePath && (basePath !== "/admin/finance" || new URLSearchParams(query).get("view") === (view || "economy")));
  });
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { window.localStorage.setItem("cinevjet-admin-theme-v2", next); } catch { /* Keep the current session theme. */ }
  }
  return (
    <div className={`admin-layout admin-theme-${theme}`}>
      <aside id="admin-sidebar" className={`admin-sidebar ${open ? "is-open" : ""}`}>
        <Link href="/admin" className="admin-brand" aria-label="CineVjet · Quản trị">
          <BrandLogo variant="compact" tone={theme} priority />
        </Link>
        <nav aria-label="Điều hướng Admin">
          <p className="admin-nav-caption">ĐIỀU HƯỚNG QUẢN TRỊ</p>
          <div className="admin-nav-list">
              {links.map(({ href, label, Icon }) => {
                const basePath = href.split("?")[0];
                const queryView = new URLSearchParams(href.split("?")[1] || "").get("view");
                const active = path === basePath && (basePath !== "/admin/finance" || queryView === (view || "economy"));
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={
                      active
                        ? "page"
                        : undefined
                    }
                    onClick={() => setOpen(false)}
                  >
                    <Icon size={20} />
                    <span>{label}</span>
                  </Link>
                );
              })}
          </div>
        </nav>
        <div className="admin-sidebar-footer">
          <ShieldCheck size={18} />
          <span>
            {name}<small>Quản trị viên</small>
          </span>
        </div>
        <Link href="/explore" className="admin-back-link">
          Về CineVjet
          <ArrowUpRight size={15} />
        </Link>
      </aside>
      {open ? (
        <button
          className="admin-sidebar-overlay"
          aria-label="Đóng điều hướng Admin"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <div className="admin-workspace">
        <div className="admin-topbar">
          <button
            className="admin-menu-toggle"
            aria-label={open ? "Đóng menu Admin" : "Mở menu Admin"}
            aria-expanded={open}
            aria-controls="admin-sidebar"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
          <span className="admin-breadcrumb"><span>Quản trị</span><ChevronRight size={15} /><strong>{activeLink?.label || "CineVjet"}</strong></span>
          <div className="admin-topbar-actions">
            <button className="admin-theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "Bật giao diện sáng" : "Bật giao diện tối"}>
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              <span>{theme === "dark" ? "Sáng" : "Tối"}</span>
            </button>
            <Link href="/profile">
              <ShieldCheck size={17} />
              <span>{name}</span>
            </Link>
          </div>
        </div>
        <div className="admin-page">{children}</div>
      </div>
    </div>
  );
}
