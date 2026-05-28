"use client";

/**
 * StockWithConversion — hiển thị tồn kho kèm quy đổi đơn vị (UOM).
 * CEO 19/05/2026 — Smart Hybrid pattern.
 *
 * 3 variant:
 *   - `inline` (mặc định) — 1 dòng compact "24 hộp · 2 thùng" cho list row
 *   - `block` — 2 dòng đầy đủ với hệ số cho detail panel
 *   - `movement` — "+24 hộp (2 thùng)" cho stock movement / phiếu nhập-xuất
 *
 * Ẩn quy đổi khi:
 *   - SP không có UOM conversion
 *   - qty < factor (chưa đủ 1 đơn vị lớn)
 *   - qty = 0
 *
 * Caller responsibility: load `conversions` (qua getUOMConversions hoặc batch
 * loader) rồi truyền vào. Component KHÔNG tự fetch để tránh N+1 query trên list.
 */

import type { UOMConversion } from "@/lib/types";
import { getConversionText, pickBestConversion } from "@/lib/format-uom";
import { formatNumber } from "@/lib/format";

interface BaseProps {
  /** Số lượng theo đơn vị nhỏ (đơn vị chính trong products.unit) */
  quantity: number;
  /** Đơn vị nhỏ — vd "hộp", "kg" */
  unit: string;
  /** Conversions của SP (caller load + cache). Trống → chỉ hiện số chính. */
  conversions?: UOMConversion[] | null;
  /** Class wrapper nếu caller cần override layout */
  className?: string;
}

interface InlineProps extends BaseProps {
  variant?: "inline";
}

interface BlockProps extends BaseProps {
  variant: "block";
  /** Cỡ chữ số chính — mặc định "text-2xl" (cho detail panel) */
  primarySize?: string;
}

interface MovementProps extends BaseProps {
  variant: "movement";
  /** true = nhập (+), false = xuất (−) */
  isInflow?: boolean;
}

type Props = InlineProps | BlockProps | MovementProps;

export function StockWithConversion(props: Props) {
  const { quantity, unit, conversions, className } = props;
  const variant = props.variant ?? "inline";
  const convText = getConversionText(quantity, unit, conversions ?? null);

  if (variant === "block") {
    const primarySize = (props as BlockProps).primarySize ?? "text-2xl";
    const conv = pickBestConversion(unit, conversions ?? null);
    return (
      <div className={className}>
        <div className={`${primarySize} font-semibold tabular-nums`}>
          {formatNumber(quantity)}{" "}
          <span className="text-base font-normal text-muted-foreground">
            {unit}
          </span>
        </div>
        {convText && conv && (
          <div className="text-xs text-muted-foreground mt-0.5">
            ={" "}
            <b className="text-foreground tabular-nums">{convText}</b>{" "}
            <span className="opacity-70">
              (1 {conv.fromUnit} = {conv.factor} {conv.toUnit})
            </span>
          </div>
        )}
      </div>
    );
  }

  if (variant === "movement") {
    const isInflow = (props as MovementProps).isInflow ?? true;
    const sign = isInflow ? "+" : "−";
    const signClass = isInflow ? "text-emerald-600" : "text-red-600";
    return (
      <span
        className={`font-semibold whitespace-nowrap tabular-nums ${className ?? ""}`}
      >
        <span className={signClass}>{sign}</span>
        {formatNumber(quantity)}{" "}
        <span className="font-normal text-muted-foreground">{unit}</span>
        {convText && (
          <span className="text-muted-foreground font-normal text-xs ml-1">
            ({convText})
          </span>
        )}
      </span>
    );
  }

  // inline (default)
  // CEO 28/05/2026: format số (phân ngàn + max 2 thập phân, bỏ đuôi float
  // "0.4000001") + đơn vị mute màu để tách bạch với số lượng.
  return (
    <span
      className={`whitespace-nowrap font-semibold tabular-nums ${className ?? ""}`}
    >
      {formatNumber(quantity)}{" "}
      <span className="font-normal text-muted-foreground">{unit}</span>
      {convText && (
        <span className="text-muted-foreground font-normal">
          {" · "}
          {convText}
        </span>
      )}
    </span>
  );
}
