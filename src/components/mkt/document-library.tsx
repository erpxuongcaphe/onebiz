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
import { parseDocumentLink, buildDocumentUrls } from "@/lib/mkt/document-links";
import { mktDelete, mktPost } from "@/lib/mkt/client";
import type { MktDocument } from "@/lib/mkt/read-models";

type CampaignOption = { id: string; name: string };

const SOURCE_LABEL: Record<string, string> = {
  drive: "Google Drive",
  gdoc: "Google Docs",
  gsheet: "Google Sheets",
  gslide: "Google Slides",
  onedrive: "OneDrive",
  pdf: "PDF",
  office_link: "Office (link)",
  other: "Link khác",
};

const CATEGORY_LABEL: Record<string, string> = {
  brief: "Brief / Yêu cầu",
  brand: "Brand / Nhận diện",
  price: "Bảng giá",
  contract: "Hợp đồng",
  report: "Báo cáo",
  other: "Khác",
};

const CATEGORY_ORDER = ["brief", "brand", "price", "contract", "report", "other"] as const;

// Icon theo loại tài liệu (đoán từ nguồn + đuôi file trong link).
function docIcon(item: MktDocument): string {
  const url = (item.externalUrl ?? "").toLowerCase();
  if (item.sourceType === "pdf" || /\.pdf(?:[?#]|$)/.test(url)) return "picture_as_pdf";
  if (item.sourceType === "gsheet" || /\.xlsx?(?:[?#]|$)/.test(url)) return "table_view";
  if (item.sourceType === "gslide" || /\.pptx?(?:[?#]|$)/.test(url)) return "slideshow";
  if (item.sourceType === "gdoc" || /\.docx?(?:[?#]|$)/.test(url)) return "description";
  if (item.sourceType === "drive") return "cloud";
  if (item.sourceType === "onedrive") return "cloud";
  return "insert_drive_file";
}

function embedOf(item: MktDocument): string | null {
  return buildDocumentUrls(item.sourceType, item.externalId, item.externalUrl).embedUrl;
}

function thumbOf(item: MktDocument): string | null {
  if (item.thumbnailUrl) return item.thumbnailUrl;
  return buildDocumentUrls(item.sourceType, item.externalId, item.externalUrl).thumbnailUrl;
}

export function DocumentLibrary({
  items,
  campaigns,
  canManageAssets,
}: {
  items: MktDocument[];
  campaigns: CampaignOption[];
  canManageAssets: boolean;
}) {
  const router = useRouter();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "available" | "archived">("available");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "name">("newest");
  const [preview, setPreview] = useState<MktDocument | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = items;
    if (categoryFilter !== "all") list = list.filter((i) => i.category === categoryFilter);
    if (statusFilter !== "all") list = list.filter((i) => i.status === statusFilter);
    if (campaignFilter) list = list.filter((i) => i.campaignId === campaignFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.description ?? "").toLowerCase().includes(q),
      );
    }
    if (sort === "name") {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title, "vi"));
    }
    return list;
  }, [items, categoryFilter, statusFilter, campaignFilter, search, sort]);

  const chip = (active: boolean) =>
    "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium " +
    (active
      ? "border-primary bg-primary/10 text-primary"
      : "border-outline-variant bg-background text-on-surface-variant hover:bg-surface-container");

  async function remove(item: MktDocument) {
    setActionError(null);
    try {
      await mktDelete(`/api/mkt/v1/documents/${item.id}`);
      setPreview(null);
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Không xoá được tài liệu");
    }
  }

  async function toggleStatus(item: MktDocument) {
    const next = item.status === "archived" ? "available" : "archived";
    setActionError(null);
    try {
      await mktPost(`/api/mkt/v1/documents/${item.id}/status`, { status: next });
      setPreview(null);
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Không đổi được trạng thái");
    }
  }

  return (
    <div className="space-y-4">
      {/* Thanh công cụ */}
      <div className="flex flex-wrap items-center gap-2">
        <button className={chip(categoryFilter === "all")} onClick={() => setCategoryFilter("all")}>
          Tất cả
        </button>
        {CATEGORY_ORDER.map((c) => (
          <button
            key={c}
            className={chip(categoryFilter === c)}
            onClick={() => setCategoryFilter(categoryFilter === c ? "all" : c)}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-outline-variant" />
        <button
          className={chip(statusFilter === "archived")}
          onClick={() => setStatusFilter(statusFilter === "archived" ? "available" : "archived")}
        >
          {statusFilter === "archived" ? "Đang xem: Lưu trữ" : "Xem lưu trữ"}
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
            placeholder="Tìm theo tên / mô tả…"
            className="h-8 pl-8"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button hidden={!canManageAssets} size="sm" onClick={() => setAddOpen(true)}>
            <Icon name="add_link" size={16} /> Thêm tài liệu
          </Button>
        </div>
      </div>

      {actionError ? <p className="text-sm font-medium text-rose-600">{actionError}</p> : null}

      <p className="text-xs text-on-surface-variant">
        💡 Để file trên <b>Google Drive / Docs / Sheets / Slides</b> rồi bấm{" "}
        <b>Thêm tài liệu</b> — xem trực tiếp mọi định dạng (pdf/excel/word/ppt) ngay tại đây, web
        không lưu file nên không giới hạn dung lượng.
      </p>

      {/* Lưới tài liệu */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => {
            const thumb = thumbOf(item);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPreview(item)}
                className="group flex gap-3 rounded-lg border border-outline-variant bg-background p-3 text-left transition hover:border-primary/40"
              >
                <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-container text-on-surface-variant">
                  <Icon name={docIcon(item)} size={30} />
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt={item.title}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold" title={item.title}>
                    {item.title}
                  </div>
                  {item.description ? (
                    <div className="mt-0.5 line-clamp-2 text-xs text-on-surface-variant">
                      {item.description}
                    </div>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-surface-container px-1.5 py-0.5 text-[10px] font-medium text-on-surface-variant">
                      {CATEGORY_LABEL[item.category] ?? item.category}
                    </span>
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      {SOURCE_LABEL[item.sourceType] ?? item.sourceType}
                    </span>
                    {item.status === "archived" ? (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        Lưu trữ
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
          {items.length === 0
            ? "Chưa có tài liệu nào. Bấm [Thêm tài liệu] để đưa file Drive/Docs/PDF vào thư viện."
            : "Không có tài liệu khớp bộ lọc."}
        </div>
      )}

      {/* Lightbox xem trực tiếp */}
      <Dialog open={Boolean(preview)} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-4xl">
          {preview ? (
            <>
              <DialogHeader>
                <DialogTitle className="truncate pr-8">{preview.title}</DialogTitle>
              </DialogHeader>
              <div className="overflow-hidden rounded-lg bg-black/5">
                {embedOf(preview) ? (
                  <iframe
                    src={embedOf(preview) as string}
                    className="h-[70vh] w-full"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                    title={preview.title}
                  />
                ) : (
                  <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 text-on-surface-variant">
                    <Icon name="visibility_off" size={32} />
                    <p className="text-sm">Không xem trực tiếp được — mở link gốc bên dưới.</p>
                  </div>
                )}
              </div>
              <DialogFooter className="flex-wrap">
                {preview.externalUrl ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() =>
                        navigator.clipboard.writeText(preview.externalUrl as string).catch(() => {})
                      }
                    >
                      <Icon name="content_copy" size={16} /> Copy link
                    </Button>
                    <a
                      href={preview.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-outline-variant bg-background px-3 text-sm font-medium hover:bg-surface-container"
                    >
                      <Icon name="open_in_new" size={16} /> Mở gốc
                    </a>
                  </>
                ) : null}
                <Button hidden={!canManageAssets} variant="outline" onClick={() => toggleStatus(preview)}>
                  <Icon name={preview.status === "archived" ? "unarchive" : "archive"} size={16} />
                  {preview.status === "archived" ? "Bỏ lưu trữ" : "Lưu trữ"}
                </Button>
                <Button hidden={!canManageAssets} variant="outline" className="text-rose-600" onClick={() => remove(preview)}>
                  <Icon name="delete" size={16} /> Xoá khỏi thư viện
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AddDocumentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        campaigns={campaigns}
        onAdded={() => router.refresh()}
      />
    </div>
  );
}

function AddDocumentDialog({
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
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("brief");
  const [description, setDescription] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = url.trim() ? parseDocumentLink(url) : null;

  async function submit() {
    // Nút bấm được luôn — thiếu thì báo rõ tại đây (không disable im lặng).
    if (!url.trim()) {
      setError("Hãy dán link tài liệu (Google Drive / Docs / PDF…).");
      return;
    }
    if (!title.trim()) {
      setError("Hãy đặt tên hiển thị cho tài liệu.");
      return;
    }
    if (!parsed) return;
    setLoading(true);
    setError(null);
    try {
      await mktPost("/api/mkt/v1/documents", {
        title: title.trim(),
        sourceType: parsed.sourceType,
        externalUrl: url.trim(),
        externalId: parsed.externalId,
        category,
        description: description.trim() || undefined,
        thumbnailUrl: parsed.thumbnailUrl ?? undefined,
        campaignId: campaignId || undefined,
      });
      setUrl("");
      setTitle("");
      setDescription("");
      setCampaignId("");
      onOpenChange(false);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thêm được tài liệu");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (loading ? null : onOpenChange(o))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Thêm tài liệu từ link</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="d-url">Link Google Drive / Docs / Sheets / PDF</Label>
            <Input
              id="d-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              autoFocus
            />
            {parsed ? (
              <p className="text-xs text-on-surface-variant">
                {parsed.canPreview
                  ? `✓ Nhận diện: ${SOURCE_LABEL[parsed.sourceType]} — xem trực tiếp được`
                  : "⚠️ Link chưa nhận diện được — vẫn lưu được nhưng chỉ mở tab ngoài, không xem trực tiếp."}
              </p>
            ) : null}
            {parsed && (parsed.sourceType === "drive" || parsed.sourceType.startsWith("g")) ? (
              <p className="text-xs text-amber-700">
                Nhớ bật chia sẻ &quot;Bất kỳ ai có link — Người xem&quot; cho file trên Google.
              </p>
            ) : null}
            {parsed?.sourceType === "office_link" ? (
              <p className="text-xs text-amber-700">
                File Office xem qua trình xem của Microsoft — link phải <b>công khai</b> thì mới hiện
                được. Nếu file nội bộ, nên đưa lên Google Drive.
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-title">Tên hiển thị</Label>
            <Input
              id="d-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Bảng giá sỉ tháng 7…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Phân loại</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-9 w-full rounded-lg border border-outline-variant bg-background px-2 text-sm"
              >
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
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
          <div className="space-y-1.5">
            <Label htmlFor="d-desc">Mô tả (tuỳ chọn)</Label>
            <Input
              id="d-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ghi chú ngắn về tài liệu…"
            />
          </div>
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button disabled={loading} onClick={submit}>
            {loading ? "Đang thêm…" : "Thêm vào thư viện"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
