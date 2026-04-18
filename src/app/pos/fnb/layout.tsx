import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FnB POS — Quầy thu ngân",
  description: "POS thu ngân F&B",
};

export default function FnbPosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
