"use client";

/**
 * InvoiceDateRow — dòng "Ngày hóa đơn" trên POS Retail (00335 Pha B).
 *
 * Mặc định: KHÔNG gửi ngày lên máy chủ → máy chủ tự lấy giờ lúc thanh toán.
 * Dòng này chỉ HIỂN THỊ giờ mà hóa đơn sắp mang, không có nhãn trạng thái nào.
 * Chỉ khi người dùng CHỦ ĐỘNG chỉnh mới hiện nhãn nhỏ "Đã chỉnh".
 *
 * Chỉnh tay: chỉ hiện nút bút chì khi có quyền `invoices.adjust_issued_at`.
 * Máy chủ vẫn kiểm lại quyền + lý do + tháng hiện tại và ghi audit — phần
 * kiểm ở đây chỉ để báo lỗi sớm cho người dùng, KHÔNG phải lớp bảo vệ.
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** ISO → chuỗi cho <input type="datetime-local"> theo GIỜ MÁY (local). */
function isoSangOInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function hienThi(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface InvoiceDateRowProps {
  /** null = để máy chủ tự lấy giờ lúc thanh toán (đường thường). */
  value: string | null;
  reason: string;
  onChange: (iso: string | null, lyDo: string) => void;
  /** Có quyền invoices.adjust_issued_at hay không. */
  canEdit: boolean;
}

export function InvoiceDateRow({ value, reason, onChange, canEdit }: InvoiceDateRowProps) {
  const [moHop, setMoHop] = useState(false);
  const [nhapNgay, setNhapNgay] = useState("");
  const [nhapLyDo, setNhapLyDo] = useState("");
  const [loiNgay, setLoiNgay] = useState<string | null>(null);
  const [loiLyDo, setLoiLyDo] = useState<string | null>(null);
  // Đồng hồ hiển thị khi CHƯA chỉnh tay — cập nhật mỗi 30 giây để thu ngân
  // luôn thấy đúng giờ hóa đơn sắp mang.
  //
  // ⚠️ KHỞI TẠO null, KHÔNG lấy new Date() ngay: trang POS được dựng sẵn trên
  // máy chủ rồi mới hydrate ở trình duyệt — giờ hai lần dựng khác nhau sẽ làm
  // React báo lệch hydrate (#418, đã nổ thật trên production 20/08). Chỉ đọc
  // đồng hồ SAU khi đã mount.
  const [gioHienTai, setGioHienTai] = useState<string | null>(null);

  useEffect(() => {
    setGioHienTai(new Date().toISOString());
    if (value) return;
    const t = setInterval(() => setGioHienTai(new Date().toISOString()), 30_000);
    return () => clearInterval(t);
  }, [value]);

  const daChinh = value !== null;
  // Trước khi mount xong, phần giờ để trống — dựng trên máy chủ và hydrate ở
  // trình duyệt ra CÙNG một chuỗi nên không lệch.
  const ngayHienThi = useMemo(() => {
    if (daChinh) return hienThi(value!);
    return gioHienTai ? hienThi(gioHienTai) : "—";
  }, [daChinh, value, gioHienTai]);

  function moDialog() {
    setNhapNgay(isoSangOInput(value ?? new Date().toISOString()));
    setNhapLyDo(reason);
    setLoiNgay(null);
    setLoiLyDo(null);
    setMoHop(true);
  }

  function xacNhan() {
    setLoiNgay(null);
    setLoiLyDo(null);

    if (!nhapNgay) {
      setLoiNgay("Chưa chọn ngày giờ.");
      return;
    }
    const chon = new Date(nhapNgay);
    if (Number.isNaN(chon.getTime())) {
      setLoiNgay("Ngày giờ không hợp lệ.");
      return;
    }
    const now = new Date();
    if (chon.getTime() > now.getTime() + 5 * 60 * 1000) {
      setLoiNgay("Không được chọn thời điểm ở tương lai quá 5 phút.");
      return;
    }
    if (
      chon.getMonth() !== now.getMonth() ||
      chon.getFullYear() !== now.getFullYear()
    ) {
      setLoiNgay("Chỉ được chỉnh trong tháng hiện tại.");
      return;
    }
    if (!nhapLyDo.trim()) {
      setLoiLyDo("Bắt buộc nhập lý do điều chỉnh.");
      return;
    }
    onChange(chon.toISOString(), nhapLyDo.trim());
    setMoHop(false);
  }

  function veGioHienTai() {
    onChange(null, "");
    setMoHop(false);
  }

  return (
    <>
      <div className="flex items-center gap-1.5 mt-1.5 px-1 text-xs">
        <Icon
          name="event"
          size={14}
          className={cn("shrink-0", daChinh ? "text-status-warning" : "text-muted-foreground")}
        />
        {/* Nhãn là phần DUY NHẤT được co lại — ngày giờ không bao giờ bị cắt. */}
        <span className="text-muted-foreground min-w-0 truncate">Ngày hóa đơn</span>
        <span
          className={cn(
            "font-semibold tabular-nums whitespace-nowrap shrink-0",
            daChinh ? "text-status-warning" : "text-foreground",
          )}
        >
          {ngayHienThi}
        </span>
        {daChinh && (
          <span
            className="shrink-0 rounded px-1 py-px text-[11px] font-medium bg-status-warning/15 text-status-warning"
            title={reason}
          >
            Đã chỉnh
          </span>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={moDialog}
            title="Sửa ngày hóa đơn"
            aria-label="Sửa ngày hóa đơn"
            className="ml-auto shrink-0 grid place-items-center rounded size-8 pointer-coarse:size-11 text-primary hover:bg-primary-fixed transition-colors"
          >
            <Icon name="edit" size={16} />
          </button>
        )}
      </div>

      <Dialog open={moHop} onOpenChange={setMoHop}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sửa ngày hóa đơn</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Ngày và giờ</label>
              <input
                type="datetime-local"
                value={nhapNgay}
                onChange={(e) => setNhapNgay(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-sm"
              />
              {loiNgay && (
                <p className="text-xs text-status-error font-medium">{loiNgay}</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">
                Lý do điều chỉnh <span className="text-status-error">*</span>
              </label>
              <textarea
                value={nhapLyDo}
                onChange={(e) => setNhapLyDo(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-sm resize-none"
              />
              {loiLyDo && (
                <p className="text-xs text-status-error font-medium">{loiLyDo}</p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            {daChinh && (
              <Button variant="ghost" onClick={veGioHienTai}>
                Về giờ hiện tại
              </Button>
            )}
            <Button variant="outline" onClick={() => setMoHop(false)}>
              Hủy
            </Button>
            <Button onClick={xacNhan}>Áp dụng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
