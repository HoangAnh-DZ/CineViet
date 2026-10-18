import type { MetadataRoute } from "next";
import { privatePaths, siteOrigin } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: privatePaths },
    sitemap: `${siteOrigin}/sitemap.xml`,
  };
}
