"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/lib/contexts";
import { getClient, getCurrentContext } from "@/lib/services/supabase/base";
import { nextEntityCode } from "@/lib/services/supabase/stock-adjustments";
import type { Database } from "@/lib/supabase/types";

type InventoryCheckInsert = Database["public"]["Tables"]["inventory_checks"]["Insert"];

interface CreateInventoryCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// Placeholder shown in the dialog header before save. Real code is generated
// via `next_code('inventory')` at save time.
const PENDING_CODE_PLACEHOLDER = "KK —";

export function CreateInventoryCheckDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateInventoryCheckDialogProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const saveLockRef = useRef(false);

  useEffect(() => {
    if (open) {
      setCode(PENDING_CODE_PLACEHOLDER);
      setNotes("");
      setErrors({});
      setSaving(false);
    }
  }, [open]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    // No required fields beyond auto-generated code
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (saveLockRef.current) return;
    if (!validate()) return;
    saveLockRef.current = true;
    setSaving(true);
    try {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      const realCode = await nextEntityCode("inventory", { tenantId: ctx.tenantId });
      setCode(realCode);

      const { error: checkErr } = await supabase
        .from("inventory_checks")
        .insert({
          tenant_id: ctx.tenantId,
          branch_id: ctx.branchId,
          code: realCode,
          status: "in_progress" as const,
          note: notes || null,
          created_by: ctx.userId,
        } satisfies InventoryCheckInsert);

      if (checkErr) throw new Error(checkErr.message);

      onOpenChange(false);
      toast({
        title: "Tạo phiếu kiểm kho thành công",
        description: `Đã tạo phiếu kiểm kho ${realCode}. Bạn có thể thêm sản phẩm kiểm kho sau.`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo phiếu kiểm kho",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      saveLockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo phiếu kiểm kho</DialogTitle>
          <DialogDescription>
            Tạo phiên kiểm kho mới. Sản phẩm sẽ được thêm sau khi tạo phiếu.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Code */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mã phiếu kiểm kho</label>
            <div className="flex h-9 w-full rounded-lg border border-input bg-muted/50 px-2.5 py-2 text-sm">
              {code}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[80px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú phiếu kiểm kho (lý do kiểm kho, khu vực kiểm...)"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Tạo phiếu kiểm kho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
