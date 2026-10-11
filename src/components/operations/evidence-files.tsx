"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { MAX_EVIDENCE_BYTES } from "@/lib/operations/evidence";
import styles from "./workspace.module.css";
import { formatDate } from "@/lib/format";

interface Attachment {
  id: string;
  file_name: string;
  created_at: string;
}
export function EvidenceFiles({
  entity,
  kind,
  canUpload,
}: {
  entity: string;
  kind: "run" | "todo";
  canUpload: boolean;
}) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setFiles([]);
    setError("");
    void fetch(`/api/operations/evidence?entity=${entity}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        setFiles(body.rows);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Không tải được minh chứng.",
          );
      });
    return () => controller.abort();
  }, [entity]);
  async function upload(file: File | undefined) {
    if (!file || lock.current) return;
    if (file.size > MAX_EVIDENCE_BYTES) {
      setError("Tệp vượt quá 5 MB.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("entity", entity);
      form.set("kind", kind);
      const response = await fetch("/api/operations/evidence", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setFiles((previous) => [body.result, ...previous]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được tệp.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function download(id: string) {
    setError("");
    try {
      const response = await fetch(
        `/api/operations/evidence?${new URLSearchParams({ entity, id })}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được tệp.");
    }
  }
  return (
    <section>
      <h3>Tệp minh chứng</h3>
      {canUpload && (
        <div className={styles.field}>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="attach_file" size={16} /> Chọn ảnh hoặc PDF
          </button>
          <input
            ref={fileInput}
            hidden
            aria-label="Tải tệp minh chứng"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={busy}
            onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      )}
      {busy && <p role="status">Đang tải minh chứng…</p>}
      {error && <p role="alert">{error}</p>}
      {files.map((file) => (
        <p key={file.id}>
          <button type="button" onClick={() => void download(file.id)}>
            <Icon name="download" size={16} />
            {file.file_name}
          </button>
          <small>{formatDate(file.created_at)}</small>
        </p>
      ))}
    </section>
  );
}
