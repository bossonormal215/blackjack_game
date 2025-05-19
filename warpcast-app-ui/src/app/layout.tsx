import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./Providers";
import FarcasterInit from "./FarcasterInit";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Blackjack Game",
  description: "A Warpcast mini app for playing Blackjack",
  openGraph: {
    title: "Blackjack Game",
    description: "Play Blackjack on Warpcast - A fun and interactive card game",
    images: [
      {
        url: "/images/og-image.png",
        width: 1200,
        height: 630,
        alt: "Blackjack Game",
      },
    ],
  },
  other: {
    "fc:frame": JSON.stringify({
      version: "next",
      imageUrl: "/images/og-image.png",
      button: {
        title: "🎮 Play Now",
        action: {
          type: "launch_frame",
          url: "/",
          name: "Blackjack Game",
          splashImageUrl: "/images/splash.png",
          splashBackgroundColor: "#1a1a1a"
        }
      }
    })
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <main className="min-h-screen bg-gray-900">
          <Providers>
            <FarcasterInit />
            {children}
          </Providers>
        </main>
      </body>
    </html>
  );
}
