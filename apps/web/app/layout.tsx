import type { Metadata, Viewport } from "next";
import { BACKGROUND_COLOR } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Karaoke",
  description: "Party karaoke: phones queue, GPU strips vocals, phones sing.",
  applicationName: "Yofi Karaoke",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Karaoke",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: BACKGROUND_COLOR,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
