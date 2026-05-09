import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Màn bếp KDS",
  description: "Kitchen Display System",
};

/**
 * KDS dùng cùng light surface với OneBiz để đồng bộ ERP/FnB, còn card đơn vẫn
 * giữ kích thước lớn và màu trạng thái rõ cho môi trường bếp.
 */
export default function KdsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
