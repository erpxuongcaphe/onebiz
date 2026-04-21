"use client";

import { useEffect, useRef } from "react";

/**
 * Barcode scanner (USB keyboard-wedge) — global listener.
 *
 * USB barcode scanner phổ biến (Zebra, Symbol, Honeywell generic) hoạt động
 * như "keyboard": quẹt mã → type từng ký tự → Enter cuối cùng. Không có API
 * riêng, không có USB HID driver — browser chỉ thấy key events liên tiếp.
 *
 * Vấn đề: nếu focus đang ở cart / dialog / button → phím "rơi" hoặc Enter
 * kích hoạt nhầm button thay vì tìm sản phẩm. Trước đây POS Retail chỉ
 * quét được khi search box đang focus.
 *
 * Giải pháp heuristic:
 *   - Đo gap giữa các phím. Scanner < 50ms/char, tay người > 100ms/char.
 *   - Buffer chars cho đến khi thấy Enter.
 *   - Nếu buffer >= minLength VÀ gap cuối cùng <= maxGapMs → coi là scan.
 *   - Nếu buffer ngắn hoặc gap chậm → bỏ (do user tay).
 *
 * Skip hoàn toàn khi target là input/textarea/contenteditable — để không
 * phá typing bình thường (user gõ tìm kiếm vẫn nhanh hơn 50ms/char khi
 * touch-typing).
 */

export interface UseBarcodeScannerOptions {
  /** Callback khi detect được 1 lần scan hoàn chỉnh. */
  onScan: (barcode: string) => void;
  /** Tắt listener (vd khi POS đang offline không scan được). Default true. */
  enabled?: boolean;
  /** Độ dài tối thiểu để coi là barcode (tránh false positive khi user nhấn 2-3 phím rồi Enter). */
  minLength?: number;
  /** Gap tối đa giữa 2 phím liên tiếp để vẫn coi là scanner (ms). */
  maxGapMs?: number;
}

export function useBarcodeScanner({
  onScan,
  enabled = true,
  minLength = 6,
  maxGapMs = 50,
}: UseBarcodeScannerOptions) {
  // Ref-based state để không bị stale closure + không trigger re-render.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    let buffer = "";
    let lastKeyTime = 0;

    const handler = (e: KeyboardEvent) => {
      // Không cướp phím khi user đang gõ trong input / textarea / contenteditable.
      // Note: search box đã tự xử lý barcode qua onKeyDown (Enter → lookup) —
      // hook này chỉ bổ sung cho trường hợp focus KHÔNG ở input.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const now = performance.now();
      const gap = lastKeyTime === 0 ? 0 : now - lastKeyTime;

      if (e.key === "Enter") {
        // Commit buffer nếu đủ dài + gap cuối cùng vẫn "nhanh".
        // gap === 0 xảy ra khi Enter là phím đầu tiên (không tính là scan).
        if (buffer.length >= minLength && gap > 0 && gap <= maxGapMs) {
          // Chặn Enter mặc định — không cho Enter click button đang hover.
          e.preventDefault();
          const scanned = buffer;
          buffer = "";
          lastKeyTime = 0;
          onScanRef.current(scanned);
          return;
        }
        // Không phải scan — reset và để Enter pass-through.
        buffer = "";
        lastKeyTime = 0;
        return;
      }

      // Chỉ buffer printable chars (key.length === 1 loại bỏ Shift/Control/F1...).
      if (e.key.length === 1) {
        // Reset buffer nếu gap quá lâu — user đã ngừng gõ, phím mới là lần bắt đầu khác.
        if (gap > maxGapMs && gap > 0) {
          buffer = "";
        }
        buffer += e.key;
        lastKeyTime = now;
      }
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [enabled, minLength, maxGapMs]);
}
