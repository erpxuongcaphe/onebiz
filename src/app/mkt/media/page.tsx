import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCampaignList, getMediaAssets, getMktContext } from "@/lib/mkt/read-models";
import { MediaLibrary, type MediaViewItem } from "@/components/mkt/media-library";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Thư viện Media" };

const BUCKET = "mkt-media";

export default async function MediaPage() {
  const supabase = await createServerSupabaseClient();
  const [assets, campaigns, ctx] = await Promise.all([
    getMediaAssets(supabase),
    getCampaignList(supabase),
    getMktContext(supabase),
  ]);

  // Signed URL (1 giờ) cho các file upload trên Storage — bucket private,
  // chỉ server (service role) cấp link đọc tạm thời.
  const uploadPaths = assets
    .filter(
      (a) =>
        a.sourceType === "upload" &&
        a.storagePath?.startsWith(`${ctx.tenantId}/`),
    )
    .map((a) => a.storagePath as string);

  const signedByPath = new Map<string, string>();
  if (uploadPaths.length > 0) {
    const admin = getAdminClient();
    const { data } = await admin.storage.from(BUCKET).createSignedUrls(uploadPaths, 3600);
    (data ?? []).forEach((entry) => {
      if (entry.signedUrl && entry.path) signedByPath.set(entry.path, entry.signedUrl);
    });
  }

  const items: MediaViewItem[] = assets.map((a) => ({
    ...a,
    signedUrl: a.storagePath ? signedByPath.get(a.storagePath) ?? null : null,
  }));

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">
            Thư viện Media
          </h1>
          <p className="text-sm text-on-surface-variant">
            Ảnh, video cho nội dung marketing — file nặng để trên Drive/YouTube, xem trực tiếp tại đây.
          </p>
        </div>

        <MediaLibrary
          items={items}
          canManageAssets={Boolean(ctx.canManageAssets)}
          campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        />
      </div>
    </div>
  );
}
