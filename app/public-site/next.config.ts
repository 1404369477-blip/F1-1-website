import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/f1plus1",
  trailingSlash: true,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  env: { NEXT_PUBLIC_F1_STATIC_SITE: "true" },
  turbopack: { root: appRoot }
};

export default nextConfig;
