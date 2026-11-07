import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { HeroUIToastProvider } from "@/components/providers/heroui-toast";
import { Web3ProviderClient } from "@/components/providers/web3-provider-client";
import { readPublicAppUrl } from "@/lib/public-url";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono-stack",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const appOrigin = readPublicAppUrl();

export const metadata: Metadata = {
  metadataBase: new URL(appOrigin),
  title: {
    default: "Proofwork",
    template: "%s · Proofwork",
  },
  description:
    "Budget pot for agents. World-verified humans. Escrow releases on all_satisfied.",
  applicationName: "Proofwork",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "Proofwork",
    title: "Proofwork",
    description:
      "Budget pot for agents. World-verified humans. Escrow releases on all_satisfied.",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Proofwork",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Proofwork",
    description:
      "Budget pot for agents. World-verified humans. Escrow releases on all_satisfied.",
    images: ["/opengraph-image.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Proofwork",
  },
  formatDetection: {
    telephone: false,
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#f4f5f7",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <Web3ProviderClient>
          {children}
          <HeroUIToastProvider />
        </Web3ProviderClient>
      </body>
    </html>
  );
}
