"use client";

import * as React from "react";
import { Input } from "./input";
import { formatNumber, formatDecimal, parseNumberInput, roundDecimals } from "@/lib/format";

interface NumericInputProps
  extends Omit<
    React.ComponentProps<typeof Input>,
    "type" | "value" | "onChange" | "min" | "max"
  > {
  /** Numeric value (kiểu number, không phải string). null/undefined = empty. */
  value: number | null | undefined;
  /** Callback nhận về number (NaN khi empty được normalize → null). */
  onChange: (value: number | null) => void;
  /** Min cho clamp. Default 0 (không cho âm) — vì 99% trường hợp ERP là tiền/SL không âm. */
  min?: number;
  /** Max cho clamp. */
  max?: number;
  /** Số chữ số sau dấu phẩy cho phép. Default 2 (tiền VND có thể đến 2 chữ số sau). */
  decimals?: number;
  /** Cho phép giá trị âm — opt-in cho cases hiếm (vd điều chỉnh tồn kho thủ công). */
  allowNegative?: boolean;
  /**
   * Force hiển thị `decimals` chữ số (vd "1,234.50" thay vì "1,234.5"). Default `false` →
   * trim trailing zeros giống `formatNumber`. Bật khi cần consistency cho cân/kg/%.
   */
  forceDecimals?: boolean;
}

/**
 * NumericInput — input số có guard min/max + decimal precision + LIVE FORMAT MASK.
 *
 * Sprint POLISH-5.2 + format unification 04/05/2026:
 * - Trước đây dùng `<input type="number">` → browser-native không có separator,
 *   không hiển thị "1,000,000" gọn. CEO chốt: số liệu toàn web có dấu phẩy ngàn
 *   en-US (formatNumber), max 2 decimals.
 * - Giờ dùng `<input type="text" inputMode="decimal">` để có thể format custom.
 * - Live mask: format khi blur (giữ cursor stable khi gõ), select all khi focus.
 *
 * Behavior:
 * - Empty input → `onChange(null)`, không phải 0 (phân biệt "chưa nhập" vs "đã nhập 0").
 * - Khi user blur, value được clamp trong [min, max] và normalize về `decimals` digits.
 * - Mặc định KHÔNG cho âm (`min=0`). Opt-in `allowNegative` cho điều chỉnh tồn.
 * - Decimal mặc định 2 — phù hợp tiền VND. Nếu là SL nguyên thì set `decimals={0}`.
 * - Display khi không focus: en-US format với phẩy ngàn, max `decimals` chữ số.
 *
 * Accessibility: `inputMode="decimal"` → mobile shows numeric keypad. Type text
 * cho phép paste "1,234,567" hoặc "1.234.567" (vi-VN fallback) đều parse được.
 *
 * ```tsx
 * <NumericInput
 *   value={qty}
 *   onChange={setQty}
 *   min={1}
 *   decimals={0}
 *   placeholder="Số lượng"
 * />
 * ```
 */
export function NumericInput({
  value,
  onChange,
  min = 0,
  max,
  decimals = 2,
  allowNegative = false,
  forceDecimals = false,
  ...rest
}: NumericInputProps) {
  // Internal text state — cho phép user gõ "0." hoặc xóa hết mà không bị
  // ép convert mỗi keystroke (giữ cursor stable, UX mượt).
  const formatForDisplay = React.useCallback(
    (n: number | null | undefined): string => {
      if (n === null || n === undefined || !Number.isFinite(n)) return "";
      if (forceDecimals) return formatDecimal(n, decimals);
      // Trim trailing zeros (formatNumber) nhưng cap max `decimals`.
      // formatNumber max 2 decimals — nếu caller muốn khác, dùng formatDecimal.
      if (decimals !== 2) {
        // Manual format cho decimals khác 2 — formatNumber default cap 2.
        return new Intl.NumberFormat("en-US", {
          maximumFractionDigits: decimals,
        }).format(n);
      }
      return formatNumber(n);
    },
    [decimals, forceDecimals],
  );

  const [text, setText] = React.useState<string>(() => formatForDisplay(value));
  const focusedRef = React.useRef(false);

  // Sync external value → text khi parent thay đổi (vd reset form). Chỉ
  // update khi không focus (tránh ghi đè input của user đang gõ).
  React.useEffect(() => {
    if (focusedRef.current) return;
    setText(formatForDisplay(value));
  }, [value, formatForDisplay]);

  const effectiveMin = allowNegative ? min : Math.max(0, min);

  const clampAndRound = (n: number): number => {
    let r = n;
    if (r < effectiveMin) r = effectiveMin;
    if (typeof max === "number" && r > max) r = max;
    return roundDecimals(r, decimals);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw); // Cho phép gõ tự do; clamp + format trên blur

    // Empty → null
    if (raw === "" || raw === "-") {
      onChange(null);
      return;
    }
    const parsed = parseNumberInput(raw);
    if (parsed === null) return; // Giữ raw text nhưng không update parent (invalid)
    onChange(clampAndRound(parsed));
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    focusedRef.current = true;
    // Convert formatted "1,234,567.89" → raw "1234567.89" để dễ edit
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      setText(String(value));
    }
    // Select all → cashier dễ replace
    e.target.select();
    rest.onFocus?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    focusedRef.current = false;
    if (text === "" || text === "-") {
      onChange(null);
      setText("");
      rest.onBlur?.(e);
      return;
    }
    const parsed = parseNumberInput(text);
    if (parsed === null) {
      onChange(null);
      setText("");
      rest.onBlur?.(e);
      return;
    }
    const final = clampAndRound(parsed);
    onChange(final);
    setText(formatForDisplay(final));
    rest.onBlur?.(e);
  };

  return (
    <Input
      type="text"
      inputMode={decimals > 0 ? "decimal" : "numeric"}
      value={text}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      data-numeric-input="active"
      {...rest}
    />
  );
}
