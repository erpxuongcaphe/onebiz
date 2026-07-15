"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import { parseMediaLink, buildMediaUrls } from "@/lib/mkt/media-links";
import { mktDelete, mktPost } from "@/lib/mkt/client";
import type { MktMediaAsset } from "@/lib/mkt/read-models";

export type MediaViewItem = MktMediaAsset & {
  /** Signed URL (1h) cho file upload trên Supabase Storage — server cấp */
  signedUrl: string | null;
};

type CampaignOption = { id: string; name: string };

const SOURCE_LABEL: Record<string, string> = {
  upload: "Tải lên",
  drive: "Google Drive",
  onedrive: "OneDrive",
  youtube: "YouTube",
  tiktok: "TikTok",
  image: "Ảnh (link)",
  video: "Video (link)",
  other: "Link khác",
};

function thumbOf(item: MediaViewItem): string | null {
  if (item.sourceType === "upload") {
    return item.kind === "image" ? item.signedUrl : null;
  }
  // Ưu tiên thumbnail đã lưu (TikTok lấy qua oEmbed, hoặc ảnh đại diện tuỳ nguồn)
  if (item.thumbnailUrl) return item.thumbnailUrl;
  return buildMediaUrls(item.sourceType, item.externalId, item.externalUrl).thumbnailUrl;
}

function embedOf(item: MediaViewItem): string | null {
  if (item.sourceType === "upload") return item.signedUrl;
  return buildMediaUrls(item.sourceType, item.externalId, item.externalUrl).embedUrl;
}

// Cách hiển thị trong popup: ảnh dùng <img>, video trực tiếp/upload dùng <video>,
// còn lại (Drive/YouTube/TikTok/OneDrive) nhúng bằng <iframe>.
function previewMode(item: MediaViewItem): "image" | "video" | "iframe" {
  if (item.sourceType === "image") return "image";
  if (item.sourceType === "video") return "video";
  if (item.sourceType === "upload") return item.kind === "image" ? "image" : "video";
  return "iframe";
}

function openUrlOf(item: MediaViewItem): string | null {
  if (item.sourceType === "upload") return item.signedUrl;
  return item.externalUrl;
}

export function MediaLibrary({
  items,
  campaigns,
  canManageAssets,
}: {
  items: MediaViewItem[];
  campaigns: CampaignOption[];
  canManageAssets: boolean;
}) {
  const router = useRouter();
  const [kindFilter, setKindFilter] = useState<"all" | "image" | "video">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "available" | "used">("all");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "name">("newest");
  const [preview, setPreview] = useState<MediaViewItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = items;
    if (kindFilter !== "all") list = list.filter((i) => i.kind === kindFilter);
    if (statusFilter !== "all") list = list.filter((i) => i.status === statusFilter);
    if (campaignFilter) list = list.filter((i) => i.campaignId === campaignFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) => i.fileName.toLowerCase().includes(q));
    }
    if (sort === "name") {
      list = [...list].sort((a, b) => a.fileName.localeCompare(b.fileName, "vi"));
    }
    return list;
  }, [items, kindFilter, statusFilter, campaignFilter, search, sort]);

  const chip = (active: boolean) =>
    "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium " +
    (active
      ? "border-primary bg-primary/10 text-primary"
      : "border-outline-variant bg-background text-on-surface-variant hover:bg-surface-container");

  async function remove(item: MediaViewItem) {
    setActionError(null);
    try {
      await mktDelete(`/api/mkt/v1/media/${item.id}`);
      setPreview(null);
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Không xoá được media");
    }
  }

  async function toggleStatus(item: MediaViewItem) {
    const next = item.status === "used" ? "available" : "used";
    setActionError(null);
    try {
      await mktPost(`/api/mkt/v1/media/${item.id}/status`, { status: next });
      setPreview(null);
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Không đổi được trạng thái media");
    }
  }

  return (
    <div className="space-y-4">
      {/* Thanh công cụ: filter + tìm + sắp xếp + thêm */}
      <div className="flex flex-wrap items-center gap-2">
        <button className={chip(kindFilter === "all")} onClick={() => setKindFilter("all")}>
          Tất cả
        </button>
        <button className={chip(kindFilter === "image")} onClick={() => setKindFilter("image")}>
          Ảnh
        </button>
        <button className={chip(kindFilter === "video")} onClick={() => setKindFilter("video")}>
          Video
        </button>
        <span className="mx-1 h-5 w-px bg-outline-variant" />
        <button className={chip(statusFilter === "available")} onClick={() => setStatusFilter(statusFilter === "available" ? "all" : "available")}>
          Sẵn dùng
        </button>
        <button className={chip(statusFilter === "used")} onClick={() => setStatusFilter(statusFilter === "used" ? "all" : "used")}>
          Đã dùng
        </button>

        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="h-8 rounded-full border border-outline-variant bg-background px-3 text-xs font-medium text-on-surface-variant"
        >
          <option value="">Mọi chiến dịch</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "newest" | "name")}
          className="h-8 rounded-full border border-outline-variant bg-background px-3 text-xs font-medium text-on-surface-variant"
        >
          <option value="newest">Mới nhất</option>
          <option value="name">Tên A→Z</option>
        </select>

        <div className="relative min-w-[160px] flex-1 sm:max-w-xs">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên…"
            className="h-8 pl-8"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* CEO 11/07: tạm KHÓA tải lên trực tiếp (tốn dung lượng server) —
              buộc thêm từ nguồn lưu trữ ngoài. Mở lại: bỏ comment <MediaUploader/>. */}
          <Button hidden={!canManageAssets} size="sm" onClick={() => setAddOpen(true)}>
            <Icon name="add_link" size={16} /> Thêm từ link
          </Button>
        </div>
      </div>

      {actionError ? (
        <p className="text-sm font-medium text-rose-600">{actionError}</p>
      ) : null}

      <p className="text-xs text-on-surface-variant">
        💡 File lưu trên Google Drive / OneDrive / YouTube — bấm <b>Thêm từ link</b> để đưa vào thư
        viện và xem trực tiếp tại đây. Web không lưu file nên không giới hạn dung lượng.
      </p>

      {/* Lưới media */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {filtered.map((item) => {
            const thumb = thumbOf(item);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPreview(item)}
                className="group rounded-lg border border-outline-variant bg-background p-2.5 text-left transition hover:border-primary/40"
              >
                <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md bg-surface-container text-on-surface-variant">
                  {/* Icon làm nền — nếu ảnh thumbnail lỗi/bị chặn (VD TikTok 403)
                      thì lộ icon thay vì ô trống. */}
                  <Icon name={item.kind === "video" ? "movie" : "image"} size={32} />
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt={item.fileName}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : null}
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {SOURCE_LABEL[item.sourceType] ?? item.sourceType}
                  </span>
                </div>
                <div className="mt-2 truncate text-xs font-medium" title={item.fileName}>
                  {item.fileName}
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[11px] text-on-surface-variant">
                  <span>{item.kind === "video" ? "Video" : item.kind === "image" ? "Ảnh" : "Khác"}</span>
                  <span
                    className={
                      "rounded-full px-1.5 " +
                      (item.status === "used"
                        ? "bg-slate-100 text-slate-500"
                        : "bg-emerald-50 text-emerald-700")
                    }
                  >
                    {item.status === "used" ? "Đã dùng" : "Sẵn dùng"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
          {items.length === 0
            ? "Chưa có media nào. Bấm [Thêm từ link] để đưa file Drive/OneDrive/YouTube vào thư viện."
            : "Không có media khớp bộ lọc."}
        </div>
      )}

      {/* Lightbox xem trực tiếp */}
      <Dialog open={Boolean(preview)} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          {preview ? (
            <>
              <DialogHeader>
                <DialogTitle className="truncate pr-8">{preview.fileName}</DialogTitle>
              </DialogHeader>
              <div className="overflow-hidden rounded-lg bg-black/5">
                {embedOf(preview) ? (
                  previewMode(preview) === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={embedOf(preview) as string}
                      alt={preview.fileName}
                      className="max-h-[65vh] w-full object-contain"
                    />
                  ) : previewMode(preview) === "video" ? (
                    <video
                      src={embedOf(preview) as string}
                      controls
                      className="max-h-[65vh] w-full bg-black"
                    />
                  ) : (
                    <iframe
                      src={embedOf(preview) as string}
                      className="aspect-video w-full"
                      allow="autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                      title={preview.fileName}
                    />
                  )
                ) : (
                  <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 text-on-surface-variant">
                    <Icon name="visibility_off" size={32} />
                    <p className="text-sm">Không xem trước được — mở link gốc bên dưới.</p>
                  </div>
                )}
              </div>
              <DialogFooter className="flex-wrap">
                {openUrlOf(preview) ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() =>
                        navigator.clipboard.writeText(openUrlOf(preview) as string).catch(() => {})
                      }
                    >
                      <Icon name="content_copy" size={16} /> Copy link
                    </Button>
                    <a
                      href={openUrlOf(preview) as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-outline-variant bg-background px-3 text-sm font-medium hover:bg-surface-container"
                    >
                      <Icon name="open_in_new" size={16} /> Mở gốc
                    </a>
                  </>
                ) : null}
                <Button hidden={!canManageAssets} variant="outline" onClick={() => toggleStatus(preview)}>
                  <Icon name={preview.status === "used" ? "restart_alt" : "task_alt"} size={16} />
                  {preview.status === "used" ? "Đánh dấu sẵn dùng" : "Đánh dấu đã dùng"}
                </Button>
                <Button hidden={!canManageAssets} variant="outline" className="text-rose-600" onClick={() => remove(preview)}>
                  <Icon name="delete" size={16} /> Xoá khỏi thư viện
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AddFromLinkDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        campaigns={campaigns}
        onAdded={() => router.refresh()}
      />
    </div>
  );
}

function AddFromLinkDialog({
  open,
  onOpenChange,
  campaigns,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaigns: CampaignOption[];
  onAdded: () => void;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"image" | "video">("video");
  const [campaignId, setCampaignId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = url.trim() ? parseMediaLink(url) : null;
  const valid = Boolean(url.trim() && name.trim());

  async function submit() {
    if (!valid || !parsed) return;
    setLoading(true);
    setError(null);
    try {
      // Loại media: ưu tiên nhận diện tự động (ảnh/video trực tiếp, YouTube/TikTok
      // luôn là video); còn lại theo ô người dùng chọn.
      const resolvedKind =
        parsed.kind ??
        (parsed.sourceType === "youtube" || parsed.sourceType === "tiktok" ? "video" : kind);
      await mktPost("/api/mkt/v1/media", {
        fileName: name.trim(),
        sourceType: parsed.sourceType,
        externalUrl: url.trim(),
        externalId: parsed.externalId,
        kind: resolvedKind,
        thumbnailUrl: parsed.thumbnailUrl ?? undefined,
        campaignId: campaignId || undefined,
      });
      setUrl("");
      setName("");
      setCampaignId("");
      onOpenChange(false);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thêm được media");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (loading ? null : onOpenChange(o))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Thêm media từ link</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="m-url">Link Google Drive / OneDrive / YouTube / TikTok</Label>
            <Input
              id="m-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/…"
              autoFocus
            />
            {parsed ? (
              <p className="text-xs text-on-surface-variant">
                {parsed.sourceType === "other"
                  ? "⚠️ Link chưa nhận diện được — vẫn lưu được nhưng chỉ mở tab ngoài, không xem trực tiếp."
                  : `✓ Nhận diện: ${SOURCE_LABEL[parsed.sourceType]}${parsed.embedUrl ? " — xem trực tiếp được" : ""}`}
              </p>
            ) : null}
            {parsed?.sourceType === "drive" ? (
              <p className="text-xs text-amber-700">
                Nhớ bật chia sẻ &quot;Bất kỳ ai có link — Người xem&quot; cho file/thư mục Drive.
              </p>
            ) : null}
            {parsed?.sourceType === "onedrive" && !parsed.embedUrl ? (
              <p className="text-xs text-amber-700">
                Link OneDrive này chỉ mở được tab ngoài. Muốn xem trực tiếp tại đây: mở OneDrive →
                chọn file → <b>Nhúng (Embed)</b> → dán nguyên mã hoặc link embed vào ô trên.
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-name">Tên hiển thị</Label>
            <Input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Video TikTok Oolong tháng 7…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Loại</Label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "image" | "video")}
                className="h-9 w-full rounded-lg border border-outline-variant bg-background px-2 text-sm"
              >
                <option value="video">Video</option>
                <option value="image">Ảnh</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Chiến dịch (tuỳ chọn)</Label>
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="h-9 w-full rounded-lg border border-outline-variant bg-background px-2 text-sm"
              >
                <option value="">—</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button disabled={loading || !valid} onClick={submit}>
            {loading ? "Đang thêm…" : "Thêm vào thư viện"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
