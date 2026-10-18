export const mainTabs = [
  { href: "/explore", label: "Khám phá" },
  { href: "/shorts", label: "Phim ngắn" },
  { href: "/rewards", label: "Phần thưởng" },
  { href: "/list", label: "Danh sách" },
  { href: "/profile", label: "Của tôi" },
] as const;

export function activeMainTab(pathname: string): string {
  for (const tab of mainTabs) {
    if (pathname === tab.href || pathname.startsWith(tab.href + "/")) return tab.href;
  }
  if (["/favorites", "/history"].includes(pathname)) return "/list";
  if (
    ["/profile", "/vip", "/wallet", "/referrals"].some(
      (route) => pathname === route || pathname.startsWith(route + "/"),
    )
  )
    return "/profile";
  return "/explore";
}
