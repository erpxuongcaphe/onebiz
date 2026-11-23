"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/lib/contexts";
import { createCategory, suggestCategoryCode } from "@/lib/services/supabase/categories";
import { isSupplierGroupCode } from "@/lib/supplier-group-code";

export function CreateSupplierGroupDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [customCode, setCustomCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const suggestion = suggestCategoryCode(name);
  const code = customCode ?? (isSupplierGroupCode(suggestion) ? suggestion : "");
  const validCode = isSupplierGroupCode(code);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (saveLock.current || !trimmedName || !validCode) return;

    saveLock.current = true;
    setSaving(true);
    setError(null);
    try {
      const group = await createCategory({ name: trimmedName, code, scope: "supplier" });
      toast({ title: "Đã tạo nhóm nhà cung cấp", description: `${group.name} (${group.code})`, variant: "success" });
      onClose();
    } catch (err) {
      const sqlCode = err && typeof err === "object" && "code" in err ? err.code : null;
      setError(sqlCode === "23505"
        ? `Mã nhóm ${code} đã có. Anh/chị nhập mã khác.`
        : "Chưa lưu được nhóm. Kiểm tra quyền thao tác hoặc kết nối rồi thử lại.");
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saveLock.current) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>Tạo nhóm nhà cung cấp</DialogTitle>
            <DialogDescription>OneBiz dùng mã nhóm để tự cấp mã cho nhà cung cấp mới.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <div className="grid gap-1.5">
              <label htmlFor="supplier-group-name" className="text-sm font-medium">Tên nhóm</label>
              <Input id="supplier-group-name" value={name} required disabled={saving}
                onChange={(event) => { setName(event.target.value); setError(null); }} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="supplier-group-code" className="text-sm font-medium">Mã nhóm</label>
              <Input id="supplier-group-code" value={code} required maxLength={8} disabled={saving}
                aria-describedby="supplier-group-code-help"
                aria-invalid={Boolean(code && !validCode)}
                onChange={(event) => { setCustomCode(event.target.value.trim().toUpperCase()); setError(null); }} />
              <p id="supplier-group-code-help" className="text-xs text-muted-foreground">
                {code === "NB" ? "Mã NB dành cho nhà cung cấp nội bộ." :
                  "Dùng 2–8 ký tự A–Z hoặc 0–9, bắt đầu bằng chữ cái."}
              </p>
              {validCode && <p className="text-sm">Mẫu mã NCC <strong>NCC-{code}-001</strong></p>}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Đóng</Button>
            <Button type="submit" disabled={saving || !name.trim() || !validCode}>{saving ? "Đang lưu…" : "Tạo nhóm"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
