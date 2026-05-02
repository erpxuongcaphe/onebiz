"use client";

import * as React from "react";
import { Input } from "./input";

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
}

/**
 * NumericInput — input số có guard min/max + decimal precision.
 *
 * Sprint POLISH-5.2: trước đây nhiều form ERP dùng `<Input type="number">`
 * không có `min={0}` → user có thể nhập số âm cho SL nhập kho, giá tiền,
 * dẫn đến state inconsistent. Audit chỉ ra 17 page có validation form,
 * nhưng đa số dialog tạo phiếu thiếu check này.
 *
 * Behavior:
 * - Empty input → onChange(null), không phải 0 (phân biệt "chưa nhập" vs "đã nhập 0").
 * - Khi user blur, value được clamp trong [min, max] và normalize về `decimals` digits.
 * - Mặc định KHÔNG cho âm (`min=0`). Opt-in `allowNegative` cho điều chỉnh tồn.
 * - Decimal mặc định 2 — phù hợp tiền VND. Nếu là SL nguyên thì set `decimals={0}`.
 *
 * Accessibility: native `<input type="number">` → keyboard up/down arrows,
 * mobile shows numeric keypad qua `inputMode="decimal"`.
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
  ...rest
}: NumericInputProps) {
  // Internal text state để cho phép user gõ "0." hoặc xóa hết — không
  // ép convert mỗi keystroke (làm UX cứng nhắc, mất con trỏ).
  const [text, setText] = React.useState<string>(
    value === null || value === undefined ? "" : String(value),
  );

  // Sync external value → text khi parent thay đổi (vd reset form).
  React.useEffect(() => {
    const next =
      value === null || value === undefined ? "" : String(value);
    if (next !== text && document.activeElement?.getAttribute("data-numeric-input") !== "active") {
      setText(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const effectiveMin = allowNegative ? min : Math.max(0, min);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    if (raw === "" || raw === "-") {
      onChange(null);
      return;
    }
    const num = Number(raw);
    if (Number.isNaN(num)) return;
    onChange(num);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (text === "" || text === "-") {
      onChange(null);
      setText("");
      return;
    }
    let num = Number(text);
    if (Number.isNaN(num)) {
      onChange(null);
      setText("");
      return;
    }
    // Clamp + round to decimals
    if (num < effectiveMin) num = effectiveMin;
    if (typeof max === "number" && num > max) num = max;
    const factor = Math.pow(10, Math.max(0, decimals));
    num = Math.round(num * factor) / factor;
    onChange(num);
    setText(String(num));
    rest.onBlur?.(e);
  };

  return (
    <Input
      type="number"
      inputMode={decimals > 0 ? "decimal" : "numeric"}
      step={decimals > 0 ? `0.${"0".repeat(decimals - 1)}1` : "1"}
      min={effectiveMin}
      max={max}
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
      data-numeric-input="active"
      {...rest}
    />
  );
}
