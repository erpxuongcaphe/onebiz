"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { createClient } from "@/lib/supabase/client";
import { mktPost } from "@/lib/mkt/client";

const BUCKET = "mkt-media";

function kindOf(file: File): string {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "other";
}

export function MediaUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      // 1. Xin signed upload URL (server, service role)
      const { path, token } = await mktPost<{ path: string; token: string }>(
        "/api/mkt/v1/media/upload-url",
        { fileName: file.name },
      );
      // 2. Tải file thẳng lên Storage qua signed URL
      const supabase = createClient();
      const { error: upErr } = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, file);
      if (upErr) throw new Error(upErr.message);
      // 3. Ghi record
      await mktPost("/api/mkt/v1/media", {
        storagePath: path,
        fileName: file.name,
        mimeType: file.type || undefined,
        sizeBytes: file.size,
        kind: kindOf(file),
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tải lên thất bại");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
        <Icon name="upload" size={16} /> {busy ? "Đang tải…" : "Tải lên"}
      </Button>
      {error ? <span className="text-xs font-medium text-rose-600">{error}</span> : null}
    </div>
  );
}
