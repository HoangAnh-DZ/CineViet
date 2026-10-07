import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AppProvider } from "@/components/providers";
import { BottomNavigation } from "@/components/navigation";
import "./globals.css";
const nunitoSans = localFont({
  src: "./fonts/NunitoSans-latin-vietnamese.woff2",
  weight: "500 800",
  style: "normal",
  display: "swap",
  variable: "--font-nunito-sans",
  preload: true,
});
export const metadata: Metadata = {
  title: { default: "CINEMA — Thế giới điện ảnh", template: "%s | CINEMA" },
  description: "Trải nghiệm điện ảnh, khám phá phim và chương trình yêu thích của bạn.",
  applicationName: "CINEMA",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080d11",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={nunitoSans.variable}>
      <body>
        <AppProvider>
          <div className="app-shell">
            <main id="main-content">{children}</main>
            <BottomNavigation />
          </div>
        </AppProvider>
      </body>
    </html>
  );
}
