import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getMediaAssets } from "@/lib/mkt/read-models";
import { MediaUploader } from "@/components/mkt/media-uploader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Thư viện Media" };

const KIND_ICON: Record<string, string> = { image: "image", video: "movie", other: "description" };

export default async function MediaPage() {
  const supabase = await createServerSupabaseClient();
  const assets = await getMediaAssets(supabase);

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
        <div className="flex flex-col gap-3 pb-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">Thư viện Media</h1>
            <p className="text-sm text-on-surface-variant">Ảnh, video dùng cho nội dung marketing.</p>
          </div>
          <MediaUploader />
        </div>

        {assets.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {assets.map((a) => (
              <div key={a.id} className="rounded-lg border border-outline-variant bg-background p-3">
                <div className="flex aspect-square items-center justify-center rounded-md bg-surface-container text-on-surface-variant">
                  <Icon name={KIND_ICON[a.kind] ?? "description"} size={32} />
                </div>
                <div className="mt-2 truncate text-xs font-medium" title={a.fileName}>
                  {a.fileName}
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[11px] text-on-surface-variant">
                  <span>{a.kind}</span>
                  <span
                    className={
                      "rounded-full px-1.5 " +
                      (a.status === "used"
                        ? "bg-slate-100 text-slate-500"
                        : "bg-emerald-50 text-emerald-700")
                    }
                  >
                    {a.status === "used" ? "Đã dùng" : "Sẵn dùng"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
            Chưa có media nào. Bấm “Tải lên” để thêm ảnh/video.
          </div>
        )}
      </div>
    </div>
  );
}
