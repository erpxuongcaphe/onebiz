"use client";

// ProductImageUpload — upload / preview / xoá ảnh sản phẩm
// Dùng Supabase Storage bucket `product-images` (migration 00038).
// Path scheme: `{tenant_id}/{timestamp}-{random}.{ext}`
//
// Design:
//   - Controlled component: nhận `value` (URL) + `onChange(url|null)`.
//   - Click hoặc drop file → upload → save public URL vào state cha.
//   - Hover preview → hiện nút × xoá (gọi remove trên storage + onChange(null)).
//   - Validate: ≤ 5MB, MIME image/*. Bucket policy cũng block — đây là fast-fail UI.

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";

interface ProductImageUploadProps {
  value?: string | null;
  onChange: (url: string | null) => void;
  /** Override tenantId — mặc định lấy từ useAuth */
  tenantId?: string;
  className?: string;
}

const BUCKET = "product-images";
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export function ProductImageUpload({
  value,
  onChange,
  tenantId: tenantIdProp,
  className,
}: ProductImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const tenantId = tenantIdProp || user?.tenantId || "default";

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast({
          variant: "error",
          title: "Chỉ nhận ảnh",
          description: "Vui lòng chọn file JPG, PNG, WEBP hoặc GIF.",
        });
        return;
      }
      if (file.size > MAX_SIZE) {
        toast({
          variant: "error",
          title: "Ảnh quá lớn",
          description: "Kích thước tối đa 5 MB. Hãy resize trước khi upload.",
        });
        return;
      }

      setUploading(true);
      try {
        const supabase = createClient();
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        // Tên file: timestamp + 6 ký tự random. Tránh collision khi 2 user
        // upload đồng thời (VD: "photo.jpg") và không phải lookup trước khi save.
        const rand = Math.random().toString(36).slice(2, 8);
        const path = `${tenantId}/${Date.now()}-${rand}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type,
          });

        if (uploadErr) {
          throw new Error(uploadErr.message || "Upload thất bại");
        }

        // Lấy public URL (bucket public=true → không cần signed URL).
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
        const publicUrl = data.publicUrl;

        // Nếu có ảnh cũ → xoá khỏi storage để không rác. Fail silent vì
        // đôi khi ảnh cũ là URL external (seed data) → không xoá được.
        if (value) {
          const oldPath = extractStoragePath(value);
          if (oldPath) {
            supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {});
          }
        }

        onChange(publicUrl);
      } catch (err) {
        toast({
          variant: "error",
          title: "Upload ảnh thất bại",
          description: err instanceof Error ? err.message : "Vui lòng thử lại.",
        });
      } finally {
        setUploading(false);
      }
    },
    [onChange, tenantId, toast, value],
  );

  const handleRemove = useCallback(async () => {
    if (!value) return;
    // Optimistic — clear state ngay, xoá storage background.
    const oldPath = extractStoragePath(value);
    onChange(null);
    if (oldPath) {
      const supabase = createClient();
      supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {});
    }
  }, [onChange, value]);

  const handleFilePick = () => inputRef.current?.click();

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadFile(file);
          // Reset để chọn lại cùng file vẫn trigger change.
          e.target.value = "";
        }}
      />

      {value ? (
        <div className="relative group inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Ảnh sản phẩm"
            className="h-24 w-24 rounded-lg border object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity gap-1">
            <button
              type="button"
              onClick={handleFilePick}
              disabled={uploading}
              className="rounded-full bg-white/90 p-1.5 hover:bg-white text-foreground"
              title="Đổi ảnh"
            >
              <Icon name="edit" size={14} />
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={uploading}
              className="rounded-full bg-white/90 p-1.5 hover:bg-destructive hover:text-white text-foreground"
              title="Xoá ảnh"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          {uploading && (
            <div className="absolute inset-0 rounded-lg bg-black/60 flex items-center justify-center">
              <Icon
                name="progress_activity"
                size={24}
                className="animate-spin text-white"
              />
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={handleFilePick}
          disabled={uploading}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) uploadFile(file);
          }}
          className={`flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed transition-colors ${
            dragOver
              ? "border-primary bg-primary/5 text-primary"
              : "border-muted-foreground/30 text-muted-foreground hover:border-primary/50 hover:text-primary"
          } disabled:opacity-50`}
        >
          {uploading ? (
            <>
              <Icon name="progress_activity" size={20} className="animate-spin" />
              <span className="text-xs">Đang tải...</span>
            </>
          ) : (
            <>
              <Icon name="add_photo_alternate" size={24} />
              <span className="text-xs">Ảnh</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

/**
 * Trích path trong bucket từ public URL. Supabase public URL có dạng:
 *   `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
 * Trả null nếu URL không phải từ bucket này (external seed image).
 */
function extractStoragePath(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}
