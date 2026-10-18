import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AppProvider } from "@/components/providers";
import { BottomNavigation } from "@/components/navigation";
import { siteOrigin } from "@/lib/site";
import "./globals.css";
import "./streaming.css";
import "@/features/library/library.css";
import "./premium-ui.css";
import "./ui-refinement.css";
import "./cinematic.css";
const nunitoSans = localFont({
  src: "./fonts/NunitoSans-latin-vietnamese.woff2",
  weight: "500 800",
  style: "normal",
  display: "swap",
  variable: "--font-nunito-sans",
  preload: true,
});
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: { default: "CineVjet — Thế giới điện ảnh", template: "%s | CineVjet" },
  description: "Trải nghiệm điện ảnh, khám phá phim và chương trình yêu thích của bạn.",
  applicationName: "CineVjet",
  openGraph: { siteName: "CineVjet", locale: "vi_VN", type: "website" },
  twitter: { card: "summary_large_image" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#090f1c",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={nunitoSans.variable}>
      <body>
        <a className="skip-link" href="#main-content">
          Đến nội dung chính
        </a>
        <AppProvider>
          <div className="app-shell">
            <BottomNavigation />
            <main id="main-content">{children}</main>
          </div>
        </AppProvider>
      </body>
    </html>
  );
}
