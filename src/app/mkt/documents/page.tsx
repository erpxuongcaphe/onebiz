import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCampaignList, getDocuments } from "@/lib/mkt/read-models";
import { DocumentLibrary } from "@/components/mkt/document-library";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Thư viện Tài liệu" };

export default async function DocumentsPage() {
  const supabase = await createServerSupabaseClient();
  const [documents, campaigns] = await Promise.all([
    getDocuments(supabase),
    getCampaignList(supabase),
  ]);

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">
            Thư viện Tài liệu
          </h1>
          <p className="text-sm text-on-surface-variant">
            Brief, bảng giá, hợp đồng, báo cáo… — để file trên Google Drive/Docs, xem trực tiếp tại đây.
          </p>
        </div>

        <DocumentLibrary
          items={documents}
          campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        />
      </div>
    </div>
  );
}
