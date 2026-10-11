import type { Metadata } from "next";
import OperationsWorkspace from "@/components/operations/workspace";

export const metadata: Metadata = {
  title: "OneBiz Hub | Vận hành",
  robots: { index: false, follow: false },
};
export default function HubPage() {
  return <OperationsWorkspace />;
}
