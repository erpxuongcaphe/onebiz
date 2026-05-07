"use client";

/**
 * BusinessLogoUpload — Upload / preview / xoá logo doanh nghiệp.
 * Sprint TEMPLATE-1 (CEO 07/05): trang thiet-lap đang dùng input URL paste,
 * thay bằng UI upload trực tiếp như ProductImageUpload.
 *
 * Bucket: tận dụng `product-images` đã có (migration 00038), path scheme
 * khác để tách riêng: `{tenant_id}/business-logo/{timestamp}-{random}.{ext}`.
 *
 * Khác ProductImageUpload:
 *   - Path prefix `business-logo/` để tách rõ trong storage.
 *   - Display ở dạng "rộng" (logo có thể wide rectangle, không phải square SP).
 *   - Padding white background để xem được logo trắng/transparent rõ.
 */

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";

interface BusinessLogoUploadProps {
  value?: string | null;
  onChange: (url: string | null) => void;
  /** Override tenantId — mặc định lấy từ useAuth */
  tenantId?: string;
  className?: string;
}

const BUCKET = "product-images";
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export function BusinessLogoUpload({
  value,
  onChange,
  tenantId: tenantIdProp,
  className,
}: BusinessLogoUploadProps) {
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
          description: "Vui lòng chọn file JPG, PNG, WEBP hoặc SVG.",
        });
        return;
      }
      if (file.size > MAX_SIZE) {
        toast({
          variant: "error",
          title: "Logo quá lớn",
          description: "Kích thước tối đa 5 MB. Hãy resize trước.",
        });
        return;
      }

      setUploading(true);
      try {
        const supabase = createClient();
        const ext = file.name.split(".").pop()?.toLowerCase() || "png";
        const rand = Math.random().toString(36).slice(2, 8);
        const path = `${tenantId}/business-logo/${Date.now()}-${rand}.${ext}`;

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

        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
        const publicUrl = data.publicUrl;

        // Xoá logo cũ nếu có (silent fail nếu external URL)
        if (value) {
          const oldPath = extractStoragePath(value);
          if (oldPath) {
            supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {});
          }
        }

        onChange(publicUrl);
        toast({
          variant: "success",
          title: "Đã tải logo",
          description: "Logo sẽ hiện trên hoá đơn + phiếu in.",
        });
      } catch (err) {
        toast({
          variant: "error",
          title: "Upload logo thất bại",
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
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadFile(file);
          e.target.value = "";
        }}
      />

      {value ? (
        <div className="relative group inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Logo doanh nghiệp"
            className="h-20 w-auto max-w-[240px] rounded-lg border border-border bg-white p-2 object-contain"
          />
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity gap-2">
            <button
              type="button"
              onClick={handleFilePick}
              disabled={uploading}
              className="rounded-full bg-white/90 p-2 hover:bg-white text-foreground"
              title="Đổi logo"
            >
              <Icon name="edit" size={14} />
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={uploading}
              className="rounded-full bg-white/90 p-2 hover:bg-status-error hover:text-white text-foreground"
              title="Xoá logo"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          {uploading && (
            <div className="absolute inset-0 rounded-lg bg-black/60 flex items-center justify-center">
              <Icon name="progress_activity" size={24} className="animate-spin text-white" />
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
          className={`flex h-20 w-48 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed transition-colors ${
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
              <Icon name="image" size={22} />
              <span className="text-xs">Tải logo lên</span>
              <span className="text-[10px] opacity-70">PNG/JPG/SVG ≤ 5MB</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

function extractStoragePath(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}
