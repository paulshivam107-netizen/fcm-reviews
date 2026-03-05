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
  title: {
    default: "FC Mobile Reviews",
    template: "%s | FC Mobile Reviews",
  },
  description:
    "Community FC Mobile player reviews and sentiment to compare cards quickly.",
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
  },
  twitter: {
    card: "summary",
    title: "FC Mobile Reviews",
    description:
      "Community FC Mobile player reviews and sentiment to compare cards quickly.",
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
