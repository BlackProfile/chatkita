import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /* Sembunyikan tombol overlay DevTools "N" di sudut — tidak relevan bagi
     pengguna akhir yang melihat pratinjau dev. */
  devIndicators: false,
  /* v13 — instrumentation.ts (auto-spawn chat-service) aktif. */
  instrumentationHook: true,
};

export default nextConfig;
