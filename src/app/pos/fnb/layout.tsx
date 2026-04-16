import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OneBiz FnB — Quầy thu ngân",
  description: "POS thu ngân F&B — OneBiz",
};

export default function FnbPosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
