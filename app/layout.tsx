import type { Metadata, Viewport } from "next";
import "@fontsource/sarabun/400.css";
import "@fontsource/sarabun/500.css";
import "@fontsource/sarabun/600.css";
import "@fontsource/sarabun/700.css";
import "./globals.css";
import { getAppSettings, hexToRgbTriplet } from "@/lib/settings";
import { PwaRegister } from "@/components/pwa";

export const metadata: Metadata = {
  title: { default: "NU Safety Inspection — ระบบการตรวจความปลอดภัย", template: "%s | NU Safety Inspection" },
  description: "ระบบการตรวจความปลอดภัย มหาวิทยาลัยนเรศวร",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = { themeColor: "#F26F21", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getAppSettings();
  const style = `:root{--brand:${hexToRgbTriplet(settings.primary_color)};--brand-dark:${hexToRgbTriplet(settings.dark_color)};--ink:${hexToRgbTriplet(settings.dark_color)}}`;
  return (
    <html lang="th">
      <head><style dangerouslySetInnerHTML={{ __html: style }} /></head>
      <body className="min-h-screen antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
