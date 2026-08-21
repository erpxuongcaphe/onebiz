"use client";

/**
 * Khối "Đơn bán từ đơn này" trên chi tiết đơn đặt hàng — CEO 17/08/2026.
 *
 * Mô hình 00331: một đơn đặt hàng → không giới hạn đơn bán con. Khối này:
 *   · đếm + liệt kê đơn con (mã, trạng thái, tiền)
 *   · bảng đối chiếu theo mặt hàng: đặt / đã bán / chênh lệch
 *   · bán vượt số đặt chỉ CẢNH BÁO NHẸ — nghiệp vụ bình thường, không chặn
 *   · nút "Tạo thêm đơn bán" (không giới hạn số lần)
 *   · nút "Hoàn tất xử lý" riêng có xác nhận rõ; hoàn tất rồi vẫn "Mở lại"
 *     hoặc tạo thêm nếu thực tế phát sinh
 *
 * Máy chủ chưa chạy 00331 (reconciliation trả null) → khối tự ẩn.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import { ConfirmDialog } from "@/components/shared/dialogs/confirm-dialog";
import {
  createChildSaleFromOrder,
  getOrderReconciliation,
  markOrderProcessed,
  donConDungDuoc,
  type ChildSaleInfo,
  type OrderReconRow,
} from "@/lib/services/supabase";

const NHAN_TRANG_THAI: Record<string, { label: string; cls: string }> = {
  draft: { label: "Nháp", cls: "bg-muted text-muted-foreground" },
  completed: { label: "Đã thanh toán", cls: "bg-status-success/10 text-status-success" },
  cancelled: { label: "Đã huỷ", cls: "bg-status-error/10 text-status-error" },
};

/** Void đè lên mọi nhãn khác: hóa đơn đã thanh toán rồi bị thu hồi. */
const NHAN_VOID = {
  label: "Đã huỷ bỏ hóa đơn",
  cls: "bg-status-error/10 text-status-error",
};

export function ChildSalesBlock({
  orderId,
  fulfilledById,
  onDataChanged,
}: {
  orderId: string;
  fulfilledById?: string;
  onDataChanged?: () => void;
}) {
  const { toast } = useToast();
  const [children, setChildren] = useState<ChildSaleInfo[]>([]);
  const [rows, setRows] = useState<OrderReconRow[]>([]);
  const [batTinhNang, setBatTinhNang] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dangTao, setDangTao] = useState(false);
  const [confirmHoanTat, setConfirmHoanTat] = useState(false);
  const [confirmMoLai, setConfirmMoLai] = useState(false);

  const taiDoiChieu = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const kq = await getOrderReconciliation(orderId);
      if (kq === null) {
        setBatTinhNang(false);
        return;
      }
      setBatTinhNang(true);
      setChildren(kq.children);
      setRows(kq.rows);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Không tải được danh sách đơn bán.",
      );
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void taiDoiChieu();
  }, [taiDoiChieu]);

  const taoThemDonBan = useCallback(async () => {
    setDangTao(true);
    try {
      const child = await createChildSaleFromOrder(orderId);
      toast({
        variant: "success",
        title: `Đã tạo đơn bán ${child.childCode}`,
        description: "Mở POS → Xử lý đặt hàng để tiếp tục, hoặc tạo thêm đơn khác.",
      });
      await taiDoiChieu();
      onDataChanged?.();
    } catch (err) {
      toast({
        variant: "error",
        title: "Không tạo được đơn bán",
        description: err instanceof Error ? err.message : "Lỗi",
      });
    } finally {
      setDangTao(false);
    }
  }, [orderId, taiDoiChieu, toast, onDataChanged]);

  // Hoàn tất: CHỈ gắn vào đơn con đã thanh toán và chưa bị huỷ/void.
  //
  // Trước đây rơi về `children[0]` khi không có đơn con nào completed — tức là
  // gắn cả đơn NHÁP hoặc đơn ĐÃ HUỶ vào đơn gốc rồi báo "đã hoàn tất xử lý",
  // trong khi chưa thu đồng nào. Không có đơn dùng được thì KHÔNG hoàn tất.
  const donConGan = children.find(donConDungDuoc) ?? null;

  // Đơn con đang được gắn ở đơn gốc — dùng để phát hiện trường hợp nó bị huỷ
  // hoặc void SAU khi đã hoàn tất (D4). Không tìm thấy trong danh sách nghĩa là
  // nó đã bị xoá mềm.
  const donConDangGan = fulfilledById
    ? children.find((c) => c.id === fulfilledById) ?? null
    : null;
  const canhBaoDonConGan =
    fulfilledById && (!donConDangGan || !donConDungDuoc(donConDangGan))
      ? donConDangGan
        ? `Đơn bán ${donConDangGan.code} đang gắn vào đơn này ${
            donConDangGan.voidedAt
              ? "đã bị huỷ bỏ hóa đơn (void)"
              : donConDangGan.cancelledAt || donConDangGan.status === "cancelled"
                ? "đã bị huỷ"
                : "chưa thanh toán"
          } — đơn đặt hàng vẫn đang mang trạng thái đã hoàn tất. Hãy Mở lại xử lý rồi đối soát.`
        : "Đơn bán đang gắn vào đơn này không còn tồn tại — đơn đặt hàng vẫn đang mang trạng thái đã hoàn tất. Hãy Mở lại xử lý rồi đối soát."
      : null;

  const hoanTat = useCallback(async () => {
    if (!donConGan) return;
    try {
      await markOrderProcessed(orderId, donConGan.id);
      toast({
        variant: "success",
        title: "Đã hoàn tất xử lý",
        description: "Đơn rời danh sách chờ ở POS. Vẫn mở lại hoặc tạo thêm đơn bán được.",
      });
      await taiDoiChieu();
      onDataChanged?.();
    } catch (err) {
      toast({
        variant: "error",
        title: "Không hoàn tất được",
        description: err instanceof Error ? err.message : "Lỗi",
      });
    }
  }, [orderId, donConGan, taiDoiChieu, toast, onDataChanged]);

  const moLai = useCallback(async () => {
    try {
      await markOrderProcessed(orderId, null);
      toast({
        variant: "success",
        title: "Đã mở lại xử lý",
        description: "Đơn quay lại danh sách chờ ở POS.",
      });
      await taiDoiChieu();
      onDataChanged?.();
    } catch (err) {
      toast({
        variant: "error",
        title: "Không mở lại được",
        description: err instanceof Error ? err.message : "Lỗi",
      });
    }
  }, [orderId, taiDoiChieu, toast, onDataChanged]);

  // Máy chủ chưa bật 00331 → không vẽ gì, giữ màn cũ nguyên vẹn.
  if (!batTinhNang) return null;

  const coBanVuot = rows.some((r) => r.delta > 0);

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold flex items-center gap-2">
          <Icon name="receipt_long" size={18} />
          Đơn bán từ đơn này
          <Badge variant="secondary">{children.length}</Badge>
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void taoThemDonBan()}
            disabled={dangTao}
          >
            <Icon name="add" size={15} className="mr-1" />
            {dangTao ? "Đang tạo..." : "Tạo thêm đơn bán"}
          </Button>
          {fulfilledById ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmMoLai(true)}
            >
              <Icon name="lock_open" size={15} className="mr-1" />
              Mở lại xử lý
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => setConfirmHoanTat(true)}
              disabled={!donConGan}
              title={
                donConGan
                  ? undefined
                  : children.length === 0
                    ? "Chưa có đơn bán nào — nếu khách không mua, dùng Huỷ đơn."
                    : "Chưa có đơn bán nào đã thanh toán và còn hiệu lực. Thanh toán đơn bán ở POS trước khi hoàn tất."
              }
            >
              <Icon name="task_alt" size={15} className="mr-1" />
              Hoàn tất xử lý
            </Button>
          )}
        </div>
      </div>

      {canhBaoDonConGan && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/5 p-3"
        >
          <Icon name="warning" size={18} className="mt-px shrink-0 text-status-warning" />
          <p className="text-sm text-status-warning">{canhBaoDonConGan}</p>
        </div>
      )}

      {loading ? (
        <p className="py-2 text-sm text-muted-foreground">
          <Icon name="progress_activity" size={16} className="mr-1 inline animate-spin" />
          Đang tải...
        </p>
      ) : loadError ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-status-error/30 bg-status-error/5 p-3">
          <p className="text-sm text-status-error">{loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void taiDoiChieu()}>
            Thử lại
          </Button>
        </div>
      ) : (
        <>
          {children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chưa có đơn bán nào. Bấm "Tạo thêm đơn bán", hoặc vào POS →
              "Xử lý đặt hàng" chọn đơn này.
            </p>
          ) : (
            <div className="space-y-1.5">
              {children.map((c) => {
                const nhan = c.voidedAt
                  ? NHAN_VOID
                  : NHAN_TRANG_THAI[c.status] ?? {
                      label: c.status,
                      cls: "bg-muted text-muted-foreground",
                    };
                return (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-outline-variant/30 px-3 py-1.5 text-sm"
                  >
                    <span className="font-medium">{c.code}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs", nhan.cls)}>
                      {nhan.label}
                    </span>
                    <span className="ml-auto tabular-nums">
                      {formatCurrency(c.total)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1.5 pr-2 font-medium">Mặt hàng</th>
                    <th className="py-1.5 px-2 text-right font-medium">Đặt</th>
                    <th className="py-1.5 px-2 text-right font-medium">Đã bán</th>
                    <th className="py-1.5 pl-2 text-right font-medium">Chênh lệch</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.productId}-${r.variantId ?? ""}`} className="border-b border-outline-variant/20">
                      <td className="py-1.5 pr-2">{r.productName}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {formatNumber(r.qtyOrdered)}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {formatNumber(r.qtySold)}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 pl-2 text-right tabular-nums",
                          r.delta > 0 && "text-status-warning font-medium",
                          r.delta < 0 && "text-muted-foreground",
                        )}
                      >
                        {r.delta > 0 ? `+${formatNumber(r.delta)}` : formatNumber(r.delta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {coBanVuot && (
            <p className="rounded-md bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
              Có mặt hàng bán vượt số đặt — nghiệp vụ bình thường, chỉ để đối
              chiếu, không chặn lưu hay thanh toán.
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmHoanTat}
        onOpenChange={setConfirmHoanTat}
        title="Hoàn tất xử lý đơn đặt hàng?"
        description={`Đơn sẽ hiện "Đã xuất hóa đơn"${donConGan ? ` (gắn với ${donConGan.code})` : ""} và rời danh sách chờ ở POS. Doanh thu, kho, công nợ KHÔNG đổi — chỉ đơn bán con đã thanh toán mới có sổ. Sau này vẫn mở lại hoặc tạo thêm đơn bán được.`}
        confirmLabel="Hoàn tất"
        cancelLabel="Chưa"
        onConfirm={() => {
          void hoanTat();
          setConfirmHoanTat(false);
        }}
      />
      <ConfirmDialog
        open={confirmMoLai}
        onOpenChange={setConfirmMoLai}
        title="Mở lại xử lý đơn này?"
        description="Đơn quay lại danh sách chờ ở POS để tạo thêm đơn bán. Các đơn bán con đã có giữ nguyên."
        confirmLabel="Mở lại"
        cancelLabel="Thôi"
        onConfirm={() => {
          void moLai();
          setConfirmMoLai(false);
        }}
      />
    </div>
  );
}
