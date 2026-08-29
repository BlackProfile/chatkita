import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ChatKita — Customer Service Chat",
  description:
    "Aplikasi chat customer service real-time: percakapan privat 1-on-1 antara customer dan admin, lengkap dengan dasbor admin untuk membalas pesan.",
  keywords: ["ChatKita", "customer service", "chat", "real-time", "Indonesia"],
  authors: [{ name: "ChatKita" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "ChatKita — Customer Service Chat",
    description:
      "Chat privat 1-on-1 dengan tim customer service kami — real-time dan mudah digunakan.",
    siteName: "ChatKita",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
