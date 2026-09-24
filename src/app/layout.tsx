import type { Metadata } from "next";
import Script from "next/script";
import { Montserrat, Geist_Mono } from "next/font/google";
import "./globals.css";

// chat-hub widget, registered as its own app ("SIHL Synapse (internal)") separate from
// the public SIHL website - api key isn't a secret (any visitor can read it via
// view-source on a widget-embedding page), so it's fine inline here rather than an env var.
const CHAT_HUB_ORIGIN = "https://chat-hub-neon.vercel.app";
const CHAT_HUB_APP_KEY = "sihl_pk_e8047ee9029689a7f86b02e40909b483";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SIHL Synapse",
  description: "SIHL Synapse — one login for your business needs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Script
          src={`${CHAT_HUB_ORIGIN}/widget.js`}
          data-app-key={CHAT_HUB_APP_KEY}
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
