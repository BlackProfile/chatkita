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
};

export default nextConfig;
