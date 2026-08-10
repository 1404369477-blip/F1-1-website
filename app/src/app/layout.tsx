import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

import { F1PageShell } from "../components/f1/f1-page-shell";
import {
  F1_DEFAULT_THEME,
  F1_THEME_COOKIE_KEY,
  isF1Theme
} from "../components/f1/theme-preference";

import "./globals.css";

export const metadata: Metadata = {
  title: "F1+1 · 公开合成资讯",
  description: "通过同源公开 API 读取已发布合成内容的 F1+1 信息流"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light"
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const savedTheme = cookieStore.get(F1_THEME_COOKIE_KEY)?.value;
  const initialTheme = isF1Theme(savedTheme) ? savedTheme : F1_DEFAULT_THEME;

  return (
    <html lang="zh-CN" data-theme={initialTheme}>
      <body data-theme={initialTheme}>
        <F1PageShell initialTheme={initialTheme}>{children}</F1PageShell>
      </body>
    </html>
  );
}
