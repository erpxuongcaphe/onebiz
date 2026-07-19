import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuditRunnerPanel } from "@/components/mkt/audit-runner-panel";
import { getMktRequestContext } from "@/lib/mkt/request-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit Runner - MKT Hub" };

export default async function AuditRunnerPage() {
  const { ctx } = await getMktRequestContext();
  if (!ctx.canAuditRunner) notFound();

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto max-w-[1400px]">
        <AuditRunnerPanel />
      </div>
    </div>
  );
}
