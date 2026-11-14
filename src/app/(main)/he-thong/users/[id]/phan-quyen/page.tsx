"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/contexts";
import { Button } from "@/components/ui/button";
import { StaffProfileEditor } from "@/components/shared/staff-profile-editor";
import {
  getStaffProfileAccess,
} from "@/lib/services/supabase/staff-profile-access";
import { getStaffOperationsAccess, saveStaffProfileOperations, type StaffOperationsSnapshot } from "@/lib/services/supabase/staff-operations-access";
import type { StaffProfileSnapshot } from "@/lib/admin/staff-profile-access";

export default function StaffProfileAccessPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const [snapshot, setSnapshot] = useState<StaffProfileSnapshot | null>(null);
  const [operations, setOperations] = useState<StaffOperationsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const load = useCallback(() => {
    if (user?.role !== "owner") return;
    request.current?.abort();
    const current = new AbortController();
    request.current = current;
    void Promise.all([getStaffProfileAccess(id), getStaffOperationsAccess(id)])
      .then(([next, ops]) => {
        if (current.signal.aborted) return;
        setSnapshot(next);
        setOperations(ops);
        setError("");
      })
      .catch((error: unknown) => {
        if (!current.signal.aborted)
          setError(
            error instanceof Error ? error.message : "Chưa tải được hồ sơ.",
          );
      });
    return () => current.abort();
  }, [id, user?.role]);
  useEffect(load, [load]);
  if (isLoading)
    return (
      <p role="status" className="p-6">
        Đang kiểm tra quyền quản lý…
      </p>
    );
  if (user?.role !== "owner")
    return (
      <p className="p-6">
        Chỉ chủ doanh nghiệp được thay đổi quyền riêng và chi nhánh truy cập.
      </p>
    );
  return (
    <main className="p-4 sm:p-6">
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-xl bg-emerald-50 p-4 text-emerald-900"
        >
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="mb-4 rounded-xl border p-4">
          <p>{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            Thử tải lại
          </Button>
        </div>
      )}
      {snapshot?.user.id === id && operations?.userId === id ? (
        <StaffProfileEditor
          key={`${snapshot.fingerprint}:${operations.fingerprint}`}
          snapshot={snapshot}
          operations={operations}
          onReload={() => void load()}
          onSave={async (draft, changes = [], deactivateQc = []) => {
            const sequence = request.current;
            const saved = await saveStaffProfileOperations(snapshot, draft, operations, changes, deactivateQc);
            if (sequence === request.current && !sequence?.signal.aborted) {
              setSnapshot(saved.profile);
              setOperations(saved.operations);
              setNotice("Đã lưu phân công, chi nhánh truy cập và quyền riêng.");
            }
          }}
        />
      ) : (
        !error && <p role="status">Đang tải hồ sơ và quyền hiện có…</p>
      )}
    </main>
  );
}
