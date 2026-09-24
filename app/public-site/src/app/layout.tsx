import type { Metadata, Viewport } from "next";

import { F1PageShell } from "../../../src/components/f1/f1-page-shell";
import { F1_DEFAULT_THEME } from "../../../src/components/f1/theme-preference";
import "../../../src/app/globals.css";

export const metadata: Metadata = {
  title: "F1+1 · F1 中文资讯",
  description: "聚合已发布的 F1 中文资讯、来源与原文入口"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light"
};

export default function PublicStaticLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-theme={F1_DEFAULT_THEME}>
      <body data-theme={F1_DEFAULT_THEME}>
        <F1PageShell initialTheme={F1_DEFAULT_THEME}>{children}</F1PageShell>
      </body>
    </html>
  );
}
