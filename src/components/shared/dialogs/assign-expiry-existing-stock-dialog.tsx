"use client";

/**
 * Dialog "Gắn HSD cho tồn cũ" — MOCKUP UI (CEO 18/05/2026)
 *
 * Mục đích: khi setup data từ phần mềm cũ qua, SP đã có tồn nhưng không có
 * HSD. Owner/admin khai báo HSD cho từng dòng tồn để hệ thống FIFO + báo
 * cáo aging hoạt động đúng.
 *
 * STATE: chỉ là MOCKUP — submit chỉ hiển thị toast "Mockup chưa lưu". Sau
 * khi CEO duyệt UI sẽ wire backend (migration 00104 + RPC + service).
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useToast } from "@/lib/contexts";
import { useAuth } from "@/lib/contexts/auth-context";
import { getProducts } from "@/lib/services";
import type { Product } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

interface AssignExpiryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ExpiryBadge({ dateStr }: { dateStr?: string | null }) {
  if (!dateStr) return null;
  const expiry = new Date(dateStr + "T00:00:00");
  if (isNaN(expiry.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((expiry.getTime() - today.getTime()) / 86400000);

  if (diffDays < 0) {
    return (
      <span className="inline-flex items-center rounded-md bg-status-danger/15 text-status-danger border border-status-danger/30 px-2 py-1 text-xs font-medium">
        ⚠ Đã quá hạn {Math.abs(diffDays)} ngày
      </span>
    );
  }
  if (diffDays === 0) {
    return (
      <span className="inline-flex items-center rounded-md bg-status-danger/15 text-status-danger border border-status-danger/30 px-2 py-1 text-xs font-medium">
        ⚠ Hết hạn HÔM NAY
      </span>
    );
  }
  if (diffDays <= 7) {
    return (
      <span className="inline-flex items-center rounded-md bg-status-danger/15 text-status-danger border border-status-danger/30 px-2 py-1 text-xs font-medium">
        ⚠ Còn {diffDays} ngày — sắp hết!
      </span>
    );
  }
  if (diffDays <= 30) {
    return (
      <span className="inline-flex items-center rounded-md bg-status-warning/15 text-status-warning border border-status-warning/30 px-2 py-1 text-xs font-medium">
        Còn {diffDays} ngày
      </span>
    );
  }
  if (diffDays <= 90) {
    return (
      <span className="inline-flex items-center rounded-md bg-status-warning/10 text-status-warning border border-status-warning/20 px-2 py-1 text-xs font-medium">
        Còn {diffDays} ngày
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-1 text-xs font-medium">
      Còn {diffDays} ngày
    </span>
  );
}

export function AssignExpiryDialog({ open, onOpenChange }: AssignExpiryDialogProps) {
  const { toast } = useToast();
  const { branches } = useAuth();

  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Load SP options khi dialog mở
  useEffect(() => {
    if (!open) return;
    (async () => {
      const result = await getProducts({ page: 0, pageSize: 500, filters: {} });
      setProducts(result.data);
    })();
  }, [open]);

  // Reset form khi close
  useEffect(() => {
    if (!open) {
      setProductId("");
      setBranchId("");
      setQuantity("");
      setExpiryDate("");
      setLotNumber("");
      setNote("");
    }
  }, [open]);

  const selectedProduct = products.find((p) => p.id === productId);
  const selectedBranch = branches.find((b) => b.id === branchId);

  // Auto-gen lot number nếu user chưa nhập
  function genAutoLotNumber() {
    if (!selectedProduct) return "";
    const code = selectedProduct.code.split("-").slice(-1)[0] ?? "X";
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `LOT-CUOSAN-${code}-${date}`;
  }

  function isValid(): boolean {
    return Boolean(
      productId &&
        branchId &&
        Number(quantity) > 0 &&
        expiryDate,
    );
  }

  async function handleSave() {
    if (!isValid()) return;
    setSaving(true);
    try {
      // MOCKUP — chưa wire backend
      await new Promise((r) => setTimeout(r, 500));
      toast({
        variant: "warning",
        title: "Mockup — chưa lưu thật",
        description: `Đây là bản xem trước UI. Khi anh duyệt em sẽ wire backend: tạo product_lot type='adjustment' với HSD ${expiryDate}, SL ${quantity}, lô ${lotNumber || genAutoLotNumber()}.`,
        duration: 10000,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="event" size={20} className="text-primary" />
            Gắn HSD cho tồn cũ
            <span className="ml-2 inline-flex items-center rounded-full bg-status-warning/15 text-status-warning border border-status-warning/30 px-2 py-0.5 text-[10px] font-semibold uppercase">
              Mockup
            </span>
          </DialogTitle>
          <DialogDescription>
            Khai báo HSD cho lượng tồn đã có sẵn (chuyển từ phần mềm cũ qua,
            hoặc trước khi triển khai BOM). Không thay đổi số tồn — chỉ ghi
            nhận HSD để FIFO + báo cáo Aging hoạt động đúng.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Cảnh báo cẩn thận */}
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
            <Icon name="info" size={14} className="inline-block mr-1 text-primary align-text-bottom" />
            <b>Owner / admin only</b>. Lot tạo bằng cách này có type=&apos;adjustment&apos;,
            audit log đầy đủ (ai, khi nào, lý do). Server validate qty không vượt
            tồn thực tế ở chi nhánh.
          </div>

          {/* Hàng 1: SP + Chi nhánh */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Sản phẩm <span className="text-destructive">*</span>
              </label>
              <Select
                value={productId || null}
                onValueChange={(v) => setProductId(v ?? "")}
                items={products.map((p) => ({
                  value: p.id,
                  label: `${p.code} — ${p.name}`,
                }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn sản phẩm">
                    {(v) => {
                      const match = products.find((p) => p.id === v);
                      return match ? `${match.code} — ${match.name}` : "Chọn sản phẩm";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedProduct && (
                <p className="text-xs text-muted-foreground">
                  Tồn hiện tại: <b className="text-foreground">{selectedProduct.stock}</b>{" "}
                  {selectedProduct.stockUnit || selectedProduct.unit || ""}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Chi nhánh <span className="text-destructive">*</span>
              </label>
              <Select
                value={branchId || null}
                onValueChange={(v) => setBranchId(v ?? "")}
                items={branches.map((b) => ({
                  value: b.id,
                  label: `${b.name}${b.branchType ? ` (${b.branchType})` : ""}`,
                }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn chi nhánh">
                    {(v) => {
                      const match = branches.find((b) => b.id === v);
                      return match ? match.name : "Chọn chi nhánh";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedBranch && (
                <p className="text-xs text-muted-foreground">
                  Loại: {selectedBranch.branchType ?? "—"}
                </p>
              )}
            </div>
          </div>

          {/* Hàng 2: Số lượng + HSD + Badge */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Số lượng <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="VD: 60"
                step="0.01"
                min="0"
              />
              <p className="text-xs text-muted-foreground">
                Theo ĐVT kho. Không vượt tồn hiện tại.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Hạn sử dụng (HSD) <span className="text-destructive">*</span>
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="flex-1"
                />
                <ExpiryBadge dateStr={expiryDate} />
              </div>
            </div>
          </div>

          {/* Hàng 3: Số lô */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Số lô</label>
            <Input
              value={lotNumber}
              onChange={(e) => setLotNumber(e.target.value)}
              placeholder={selectedProduct ? `Auto: ${genAutoLotNumber()}` : "VD: LOT-CUOSAN-001"}
            />
            <p className="text-xs text-muted-foreground">
              Để trống → tự sinh format <code className="text-[10px]">LOT-CUOSAN-{"<MÃ>"}-{"<NGÀY>"}</code>
            </p>
          </div>

          {/* Hàng 4: Ghi chú */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Lý do khai báo <span className="text-destructive">*</span>
            </label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: Khai báo tồn cũ chuyển từ KiotViet — cà phê đã nhập từ Đắk Lắk 03/2026"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Lưu vào audit log để truy vết. Bắt buộc — không cho khai báo
              không lý do.
            </p>
          </div>

          {/* Preview cuối */}
          {isValid() && selectedProduct && selectedBranch && (
            <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3 text-sm">
              <div className="font-semibold mb-2 flex items-center gap-1">
                <Icon name="visibility" size={14} className="text-primary" />
                Xem trước
              </div>
              <ul className="space-y-1 text-xs">
                <li>
                  • Tạo 1 lot <b>{lotNumber || genAutoLotNumber()}</b> với{" "}
                  <b>{quantity}</b> {selectedProduct.stockUnit || ""} của{" "}
                  <b>{selectedProduct.name}</b>
                </li>
                <li>
                  • Tại chi nhánh: <b>{selectedBranch.name}</b>
                </li>
                <li>
                  • HSD: <b>{expiryDate}</b> — <ExpiryBadge dateStr={expiryDate} />
                </li>
                <li>
                  • Type: <code className="text-[10px]">adjustment</code> (không
                  thay đổi tồn, chỉ ghi nhận HSD)
                </li>
                <li>
                  • Audit log lưu: lý do + người khai báo + thời gian
                </li>
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={!isValid() || !note.trim() || saving}>
            {saving ? (
              <>
                <Icon name="progress_activity" size={14} className="mr-1.5 animate-spin" />
                Đang lưu...
              </>
            ) : (
              <>
                <Icon name="event_available" size={14} className="mr-1.5" />
                Gắn HSD
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
