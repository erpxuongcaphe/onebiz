"use client";

/**
 * Sửa phiếu nhập đã nhập kho mà KHÔNG phải huỷ (CEO 29/07/2026).
 *
 * Trước đây muốn sửa bất cứ gì đều phải hoàn nhập toàn bộ rồi làm lại — mà
 * hàng đã bán bớt thì bị chặn, nên gần như tắc đường (120/128 phiếu hoàn
 * thành đã bán bớt).
 *
 * Ở đây chỉ cho sửa PHẦN KHÔNG ĐỤNG KHO. Ô số lượng khoá lại, có dòng giải
 * thích vì sao — để người dùng hiểu chứ không tưởng hệ thống thiếu tính năng.
 */

import { useEffect, useMemo, useState } from "react";
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
import { useToast } from "@/lib/contexts";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  getPurchaseOrderEditData,
  getPurchaseOrderItems,
  suaGiaPhieuNhap,
} from "@/lib/services/supabase/purchase-orders";

interface DongHang {
  id: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  vatRate: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chỉ cần id + mã; phần còn lại dialog tự đọc để luôn đúng số mới nhất. */
  order: { id: string; code: string } | null;
  onDone?: () => void;
}

const so = (v: string) => {
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function EditPurchaseOrderDialog({ open, onOpenChange, order, onDone }: Props) {
  const { toast } = useToast();
  const [dangTai, setDangTai] = useState(false);
  const [dangLuu, setDangLuu] = useState(false);
  const [dong, setDong] = useState<DongHang[]>([]);
  const [ghiChu, setGhiChu] = useState("");
  const [phiVanChuyen, setPhiVanChuyen] = useState(0);
  const [chiPhiKhac, setChiPhiKhac] = useState(0);
  const [giamGiaPhieu, setGiamGiaPhieu] = useState(0);
  const [tongCu, setTongCu] = useState(0);
  const [daTra, setDaTra] = useState(0);

  useEffect(() => {
    if (!open || !order) return;
    setDangTai(true);
    Promise.all([getPurchaseOrderEditData(order.id), getPurchaseOrderItems(order.id)])
      .then(([phieu, items]) => {
        setGhiChu(phieu.note ?? "");
        setPhiVanChuyen(phieu.shippingCost);
        setChiPhiKhac(phieu.otherCost);
        setGiamGiaPhieu(phieu.orderDiscount);
        setTongCu(phieu.total);
        setDaTra(phieu.paid);
        setDong(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (items as any[]).map((i) => ({
            id: i.id,
            productName: i.productName ?? i.product_name ?? "—",
            unit: i.unit ?? "",
            quantity: Number(i.quantity ?? 0),
            unitPrice: Number(i.unitPrice ?? i.unit_price ?? 0),
            discount: Number(i.discount ?? 0),
            vatRate: Number(i.vatRate ?? i.vat_rate ?? 0),
          })),
        );
      })
      .catch((e) =>
        toast({
          variant: "error",
          title: "Không tải được mặt hàng",
          description: e instanceof Error ? e.message : "Lỗi không xác định",
        }),
      )
      .finally(() => setDangTai(false));
  }, [open, order, toast]);

  const tongMoi = useMemo(() => {
    const hang = dong.reduce((s, d) => s + Math.round(d.quantity * d.unitPrice - d.discount), 0);
    const vat = dong.reduce(
      (s, d) => s + Math.round(Math.round(d.quantity * d.unitPrice - d.discount) * (d.vatRate / 100)),
      0,
    );
    return hang + vat + phiVanChuyen + chiPhiKhac - giamGiaPhieu;
  }, [dong, phiVanChuyen, chiPhiKhac, giamGiaPhieu]);

  const chenh = tongMoi - tongCu;

  async function luu() {
    if (!order) return;
    const am = dong.find((d) => d.quantity * d.unitPrice - d.discount < 0);
    if (am) {
      toast({
        variant: "warning",
        title: "Chiết khấu lớn hơn tiền hàng",
        description: `Dòng "${am.productName}" đang bị âm — kiểm tra lại.`,
      });
      return;
    }
    setDangLuu(true);
    try {
      const kq = await suaGiaPhieuNhap({
        orderId: order.id,
        items: dong.map((d) => ({
          id: d.id,
          unitPrice: d.unitPrice,
          discount: d.discount,
          vatRate: d.vatRate,
        })),
        note: ghiChu,
        shippingCost: phiVanChuyen,
        otherCost: chiPhiKhac,
        orderDiscount: giamGiaPhieu,
      });
      toast({
        variant: "success",
        title: "Đã sửa phiếu nhập",
        description: `${kq.soDongSua} dòng · tổng ${formatCurrency(kq.tongCu)} → ${formatCurrency(kq.tongMoi)} · còn nợ ${formatCurrency(kq.conNo)}`,
      });
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast({
        variant: "error",
        title: "Không sửa được phiếu",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
      });
    } finally {
      setDangLuu(false);
    }
  }

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="edit_document" size={20} />
            Sửa phiếu nhập {order.code}
          </DialogTitle>
        </DialogHeader>

        {/* Nói rõ giới hạn NGAY ĐẦU, trước khi người dùng đi tìm ô số lượng */}
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <div className="flex gap-2">
            <Icon name="info" size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p>
                Sửa được <strong>giá, chiết khấu, thuế, chi phí và ghi chú</strong> —
                không đụng tới kho.
              </p>
              <p className="text-muted-foreground">
                <strong>Số lượng không sửa ở đây.</strong> Đổi số lượng là phải cộng
                trừ lại kho, mà hàng đã bán bớt thì rút ra sẽ âm — muốn đổi số lượng
                dùng “Mở lại để sửa”.
              </p>
              <p className="text-muted-foreground">
                Giá vốn của hàng <strong>đã bán</strong> giữ nguyên như lúc bán, không
                tính lại.
              </p>
            </div>
          </div>
        </div>

        {dangTai ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Đang tải mặt hàng…</p>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2">Mặt hàng</th>
                    <th className="w-24 py-2 pr-2 text-right">Số lượng</th>
                    <th className="w-32 py-2 pr-2 text-right">Đơn giá</th>
                    <th className="w-28 py-2 pr-2 text-right">Chiết khấu</th>
                    <th className="w-20 py-2 pr-2 text-right">Thuế %</th>
                    <th className="w-32 py-2 text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {dong.map((d, idx) => {
                    const thanhTien = Math.round(d.quantity * d.unitPrice - d.discount);
                    return (
                      <tr key={d.id} className="border-b last:border-0">
                        <td className="py-2 pr-2">
                          <div className="font-medium">{d.productName}</div>
                          <div className="text-xs text-muted-foreground">{d.unit}</div>
                        </td>
                        <td className="py-2 pr-2 text-right">
                          {/* Khoá — kèm lý do ở tooltip cho người tò mò */}
                          <span
                            className="tabular-nums text-muted-foreground"
                            title="Đổi số lượng phải cộng trừ lại kho — dùng “Mở lại để sửa”"
                          >
                            {formatNumber(d.quantity)}
                          </span>
                        </td>
                        <td className="py-2 pr-2">
                          <Input
                            className="h-8 text-right tabular-nums"
                            value={d.unitPrice}
                            onChange={(e) =>
                              setDong((p) =>
                                p.map((x, i) => (i === idx ? { ...x, unitPrice: so(e.target.value) } : x)),
                              )
                            }
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <Input
                            className="h-8 text-right tabular-nums"
                            value={d.discount}
                            onChange={(e) =>
                              setDong((p) =>
                                p.map((x, i) => (i === idx ? { ...x, discount: so(e.target.value) } : x)),
                              )
                            }
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <Input
                            className="h-8 text-right tabular-nums"
                            value={d.vatRate}
                            onChange={(e) =>
                              setDong((p) =>
                                p.map((x, i) => (i === idx ? { ...x, vatRate: so(e.target.value) } : x)),
                              )
                            }
                          />
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums font-medium ${thanhTien < 0 ? "text-destructive" : ""}`}
                        >
                          {formatCurrency(thanhTien)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-xs">Phí vận chuyển</Label>
                <Input
                  className="h-8 text-right tabular-nums"
                  value={phiVanChuyen}
                  onChange={(e) => setPhiVanChuyen(so(e.target.value))}
                />
              </div>
              <div>
                <Label className="text-xs">Chi phí khác</Label>
                <Input
                  className="h-8 text-right tabular-nums"
                  value={chiPhiKhac}
                  onChange={(e) => setChiPhiKhac(so(e.target.value))}
                />
              </div>
              <div>
                <Label className="text-xs">Giảm giá cả phiếu</Label>
                <Input
                  className="h-8 text-right tabular-nums"
                  value={giamGiaPhieu}
                  onChange={(e) => setGiamGiaPhieu(so(e.target.value))}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Ghi chú</Label>
              <Input value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} />
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tổng cũ</span>
                <span className="tabular-nums">{formatCurrency(tongCu)}</span>
              </div>
              <div className="flex items-center justify-between font-medium">
                <span>Tổng mới</span>
                <span className="tabular-nums">{formatCurrency(tongMoi)}</span>
              </div>
              {chenh !== 0 && (
                <div
                  className={`mt-1 flex items-center justify-between border-t pt-1 ${chenh > 0 ? "text-destructive" : "text-emerald-600"}`}
                >
                  <span>{chenh > 0 ? "Phải trả thêm" : "Trả bớt"}</span>
                  <span className="tabular-nums font-medium">
                    {formatCurrency(Math.abs(chenh))}
                  </span>
                </div>
              )}
              <div className="mt-1 flex items-center justify-between border-t pt-1 text-muted-foreground">
                <span>Đã trả</span>
                <span className="tabular-nums">{formatCurrency(daTra)}</span>
              </div>
              <div className="flex items-center justify-between font-medium">
                <span>Còn nợ sau khi sửa</span>
                <span className="tabular-nums">
                  {formatCurrency(Math.max(0, tongMoi - daTra))}
                </span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={dangLuu}>
            Đóng
          </Button>
          <Button onClick={luu} disabled={dangLuu || dangTai || dong.length === 0}>
            {dangLuu ? "Đang lưu…" : "Lưu thay đổi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
