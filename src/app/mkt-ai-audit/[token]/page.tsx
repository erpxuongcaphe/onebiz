import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuditRunnerPublicPanel } from "@/components/mkt/audit-runner-public-panel";
import { isValidMktAuditAccessToken } from "@/lib/mkt/audit-access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "AI Audit Runner - MKT Hub",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function MktAiAuditPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!isValidMktAuditAccessToken(token)) notFound();

  return (
    <main className="min-h-screen bg-surface-container-low px-4 py-5 text-on-surface sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1400px]">
        <AuditRunnerPublicPanel token={token} />
      </div>
    </main>
  );
}