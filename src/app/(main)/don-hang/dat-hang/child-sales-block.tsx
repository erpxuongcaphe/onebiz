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
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import { ConfirmDialog } from "@/components/shared/dialogs/confirm-dialog";
import {
  createChildSaleFromOrder,
  confirmWarehouseOrderWeighedQuantity,
  getOrderReconciliation,
  markOrderProcessed,
  reopenSalesOrderProcessing,
  donConDungDuoc,
  type ChildSaleInfo,
  type OrderReconRow,
} from "@/lib/services/supabase";
import { buildInvoiceListDeepLink } from "@/lib/utils/invoice-list-deep-link";

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
  processingClosedAt,
  processingClosedReason,
  onDataChanged,
}: {
  orderId: string;
  fulfilledById?: string;
  processingClosedAt?: string;
  processingClosedReason?: string;
  onDataChanged?: () => void;
}) {
  const { toast } = useToast();
  const [children, setChildren] = useState<ChildSaleInfo[]>([]);
  const [rows, setRows] = useState<OrderReconRow[]>([]);
  const [warehouseDelivery, setWarehouseDelivery] = useState(false);
  const [weighedDraft, setWeighedDraft] = useState<{ id: string; updatedAt: string; excess: OrderReconRow[] }>();
  const [confirmWeighing, setConfirmWeighing] = useState(false);
  const [savingWeighing, setSavingWeighing] = useState(false);
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
      setWarehouseDelivery(Boolean(kq.warehouseDelivery));
      setWeighedDraft(kq.weighedDraft);
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
        description: warehouseDelivery ? "Mở đợt giao nháp trong POS để chọn lượng giao lần này." : "Mở POS → Xử lý đặt hàng để tiếp tục, hoặc tạo thêm đơn khác.",
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
  }, [orderId, taiDoiChieu, toast, onDataChanged, warehouseDelivery]);

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
      if (processingClosedAt) await reopenSalesOrderProcessing(orderId);
      else await markOrderProcessed(orderId, null);
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
  }, [orderId, processingClosedAt, taiDoiChieu, toast, onDataChanged]);

  async function confirmWeighedQuantity() {
    if (!weighedDraft || savingWeighing) return;
    setSavingWeighing(true);
    try {
      await confirmWarehouseOrderWeighedQuantity(orderId, weighedDraft.id, weighedDraft.updatedAt);
      toast({ variant: "success", title: "Đã cập nhật lượng đặt theo cân thực tế" });
      onDataChanged?.();
    } catch (err) {
      toast({ variant: "error", title: "Chưa xác nhận được lượng cân", description: err instanceof Error ? err.message : "Lỗi" });
    } finally {
      setConfirmWeighing(false);
      setSavingWeighing(false);
      await taiDoiChieu();
    }
  }

  // Máy chủ chưa bật 00331 → không vẽ gì, giữ màn cũ nguyên vẹn.
  if (!batTinhNang) return null;

  const coDieuChinh = rows.some((r) => r.delta !== 0);
  const remainingLines = rows.filter((r) => r.delta < 0).length;
  const hasDraft = children.some((c) => c.status === "draft" && !c.cancelledAt && !c.voidedAt);
  const deliveryClosed = Boolean(fulfilledById || processingClosedAt);
  const canStartDelivery = !loading && !loadError && !deliveryClosed && remainingLines > 0 && !hasDraft;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold flex items-center gap-2">
          <Icon name="receipt_long" size={18} />
          {warehouseDelivery ? "Các đợt giao từ đơn gốc" : "Đơn bán từ đơn này"}
          <Badge variant="secondary">{children.length}</Badge>
          {(warehouseDelivery ? remainingLines > 0 : coDieuChinh) ? (
            <Badge variant="outline" className="border-status-warning/30 bg-status-warning/10 text-status-warning">
              {warehouseDelivery ? `${remainingLines} mặt hàng còn thiếu` : "Có điều chỉnh"}
            </Badge>
          ) : null}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void taoThemDonBan()}
            disabled={dangTao || (warehouseDelivery && !canStartDelivery)}
          >
            <Icon name="add" size={15} className="mr-1" />
            {dangTao ? "Đang tạo..." : warehouseDelivery ? "Giao phần còn thiếu" : "Tạo thêm đơn bán"}
          </Button>
          {fulfilledById || processingClosedAt ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmMoLai(true)}
            >
              <Icon name="lock_open" size={15} className="mr-1" />
              Mở lại xử lý
            </Button>
          ) : !warehouseDelivery ? (
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
          ) : null}
        </div>
      </div>

      {warehouseDelivery && hasDraft && (
        <p className="text-xs text-muted-foreground">Đã có đợt giao nháp. Bấm mã nháp bên dưới để mở trong POS.</p>
      )}
      {warehouseDelivery && !deliveryClosed && !loading && !loadError && Boolean(weighedDraft?.excess.length) && (
        <div className="rounded-md border border-status-warning/40 p-3 space-y-2">
          <p className="text-sm font-medium">Nháp có lượng cân vượt số còn lại</p>
          <ul className="text-sm">
            {weighedDraft?.excess.map((row) => (
              <li key={[row.productId, row.variantId, row.unit].join(":")}>
                {row.productName} · +{formatNumber(row.delta)} {row.unit}
              </li>
            ))}
          </ul>
          <Button type="button" size="sm" variant="outline" disabled={savingWeighing}
            onClick={() => setConfirmWeighing(true)}>Xác nhận lượng cân vượt</Button>
        </div>
      )}
      {processingClosedAt && <p className="text-xs text-status-success">
        Đã xử lý · {processingClosedReason} · {new Date(processingClosedAt).toLocaleString("vi-VN")}
      </p>}

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
              {warehouseDelivery
                ? "Chưa có đợt giao. Chọn Giao phần còn thiếu để chuẩn bị hàng xuất."
                : "Chưa có đơn bán nào. Chọn Tạo thêm đơn bán, hoặc mở Xử lý đặt hàng trong POS."}
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
                    {c.code ? (
                      <Link
                        href={warehouseDelivery && c.status === "draft" ? `/pos?draftId=${encodeURIComponent(c.id)}` : buildInvoiceListDeepLink(c.code)}
                        className="font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Mở hóa đơn ${c.code}`}
                      >
                        {c.code}
                      </Link>
                    ) : (
                      <span className="font-medium">—</span>
                    )}
                    <span className={cn("rounded-full px-2 py-0.5 text-xs", nhan.cls)}>
                      {warehouseDelivery && donConDungDuoc(c) && c.source === "internal" ? "Đã xuất giao" : nhan.label}
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
                    <th className="py-1.5 px-2 text-right font-medium">{warehouseDelivery ? "Đã xuất giao" : "Đã bán"}</th>
                    <th className="py-1.5 pl-2 text-right font-medium">{warehouseDelivery ? "Còn thiếu" : "Chênh lệch"}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.productId}-${r.variantId ?? ""}-${r.unit}`} className="border-b border-outline-variant/20">
                      <td className="py-1.5 pr-2">{r.productName}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {formatNumber(r.qtyOrdered)} {warehouseDelivery ? r.unit : ""}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {formatNumber(r.qtySold)}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 pl-2 text-right tabular-nums",
                          (warehouseDelivery ? r.delta < 0 : r.delta > 0) && "text-status-warning font-medium",
                        )}
                      >
                        {warehouseDelivery ? formatNumber(Math.max(0, -r.delta)) : r.delta > 0 ? `+${formatNumber(r.delta)}` : formatNumber(r.delta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {coDieuChinh && !warehouseDelivery && (
            <p className="rounded-md bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
              Số lượng thực bán khác đơn đặt ban đầu — đây có thể là thay đổi
              của khách, chỉ để đối chiếu; không chặn lưu, thanh toán hay chốt
              hoàn tất.
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmWeighing}
        onOpenChange={setConfirmWeighing}
        title="Cập nhật lượng đặt theo cân thực tế?"
        description={weighedDraft?.excess.map((row) =>
          row.productName + " +" + formatNumber(row.delta) + " " + row.unit).join(", ") ?? ""}
        confirmLabel="Xác nhận"
        cancelLabel="Xem lại"
        onConfirm={() => void confirmWeighedQuantity()}
      />
      <ConfirmDialog
        open={confirmHoanTat}
        onOpenChange={setConfirmHoanTat}
        title="Hoàn tất xử lý đơn đặt hàng?"
        description="Đơn rời danh sách cần xử lý, vẫn lưu trong lịch sử. Không tạo hóa đơn, ghi nhận thêm tiền hoặc hàng. Có thể chủ động mở lại khi cần."
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
