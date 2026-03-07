import type { Metadata } from "next";
import { Sora } from "next/font/google";
import { getSiteUrl } from "@/lib/site-url";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  applicationName: "FC Mobile Reviews",
  title: {
    default: "FC Mobile Reviews",
    template: "%s | FC Mobile Reviews",
  },
  description:
    "Community FC Mobile player reviews and sentiment to compare cards quickly.",
  keywords: [
    "FC Mobile",
    "FC Mobile reviews",
    "FC Mobile player reviews",
    "FC Mobile card sentiment",
    "FC Mobile top attackers",
    "FC Mobile top midfielders",
    "FC Mobile top defenders",
    "FC Mobile top goalkeepers",
  ],
  category: "gaming",
  authors: [{ name: "FC Mobile Reviews" }],
  creator: "FC Mobile Reviews",
  publisher: "FC Mobile Reviews",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    title: "FC Mobile Reviews",
    description:
      "Community FC Mobile player reviews and sentiment to compare cards quickly.",
    url: "/",
    siteName: "FC Mobile Reviews",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "FC Mobile Reviews",
    description:
      "Community FC Mobile player reviews and sentiment to compare cards quickly.",
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GSC_VERIFICATION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sora.variable} font-[var(--font-sora)] antialiased`}>
        {children}
      </body>
    </html>
  );
}
