import type { Metadata } from "next";
import OperationsWorkspace from "@/components/operations/workspace";
import Link from "next/link";
import { readHubAccess } from "@/lib/operations/access";

export const metadata: Metadata = {
  title: "OneBiz Hub | Vận hành",
  robots: { index: false, follow: false },
};
export default async function HubPage() {
  const access = await readHubAccess();
  if (!access.allowed) return <main className="mx-auto max-w-2xl p-6"><h1 className="text-xl font-semibold">Hub vận hành</h1><p role="alert" className="my-4">{access.error}</p><Link href={access.status === 401 ? "/dang-nhap?redirect=%2Fhub" : "/"}>{access.status === 401 ? "Đăng nhập OneBiz" : "Về ERP"}</Link></main>;
  return <OperationsWorkspace />;
}
