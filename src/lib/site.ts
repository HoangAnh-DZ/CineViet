export const customProductionOrigin = "https://cine-vjet.cyou";

export function configuredSiteOrigin() {
  return new URL(process.env.NEXT_PUBLIC_APP_URL || customProductionOrigin).origin;
}
export const siteOrigin = configuredSiteOrigin();

export const privatePaths = [
  "/admin",
  "/api",
  "/login",
  "/register",
  "/profile",
  "/wallet",
  "/payments",
  "/rewards",
  "/referrals",
  "/list",
  "/favorites",
  "/history",
  "/watch",
  "/vip",
];
