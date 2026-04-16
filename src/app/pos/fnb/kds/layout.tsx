import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Màn hình bếp — OneBiz FnB",
  description: "KDS Kitchen Display System — OneBiz",
};

export default function KdsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
