import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Compare FC Mobile Player Cards – FC Mobile Reviews",
  description:
    "Compare FC Mobile player card reviews, community ratings, strengths, weaknesses, and recent feedback side by side.",
};

export default function CompareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
