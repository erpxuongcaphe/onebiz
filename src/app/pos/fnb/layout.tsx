import type { Metadata } from "next";
import { FnbLegacyColors } from "./components/fnb-legacy-colors";

export const metadata: Metadata = {
  title: "FnB POS — Quầy thu ngân",
  description: "POS thu ngân F&B",
};

export default function FnbPosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <FnbLegacyColors />
      {children}
    </>
  );
}
