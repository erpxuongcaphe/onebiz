/**
 * Chart palette — đọc từ Stitch CSS tokens để Recharts/visx tự
 * theo dark mode.
 *
 * Sprint POLISH-4.3: trước đây 20 file phân tích/charts hardcode hex
 * (`fill="#004AC6"`, `EXPENSE_COLORS = ["#004AC6", "#ea580c", ...]`).
 * Khi user toggle dark mode, charts giữ màu sáng → tương phản kém.
 *
 * Hai cách dùng:
 *
 * 1. **Static reference qua CSS var** (preferred khi component server-render
 *    cần color string ổn định):
 *    ```tsx
 *    <Bar fill="var(--color-chart-1)" />
 *    ```
 *
 * 2. **Resolved hex tại runtime** (khi cần truyền vào lib không nhận CSS var,
 *    vd `react-pdf` export):
 *    ```ts
 *    const palette = getChartPalette(); // ["oklch(...)", ...]
 *    ```
 *
 * Tokens có sẵn:
 * - `chart-1` ... `chart-6`: palette chính (xoay vòng)
 * - `status-success/warning/error/info/neutral`: dùng cho semantic charts
 *   (vd "Lãi" success, "Lỗ" error, "Hoà vốn" neutral).
 */

/** Tên CSS variable cho từng slot palette. */
export const CHART_TOKEN_VAR = {
  chart1: "var(--color-chart-1)",
  chart2: "var(--color-chart-2)",
  chart3: "var(--color-chart-3)",
  chart4: "var(--color-chart-4)",
  chart5: "var(--color-chart-5)",
  chart6: "var(--color-chart-6)",
  success: "var(--color-status-success)",
  warning: "var(--color-status-warning)",
  error: "var(--color-status-error)",
  info: "var(--color-status-info)",
  neutral: "var(--color-status-neutral)",
} as const;

/** Palette default (6 slot xoay vòng) cho bar/line/pie chart. */
export const CHART_PALETTE: readonly string[] = [
  CHART_TOKEN_VAR.chart1,
  CHART_TOKEN_VAR.chart2,
  CHART_TOKEN_VAR.chart3,
  CHART_TOKEN_VAR.chart4,
  CHART_TOKEN_VAR.chart5,
  CHART_TOKEN_VAR.chart6,
];

/** Semantic palette cho expense/income/neutral. */
export const CHART_SEMANTIC = {
  income: CHART_TOKEN_VAR.success,
  expense: CHART_TOKEN_VAR.error,
  neutral: CHART_TOKEN_VAR.neutral,
  highlight: CHART_TOKEN_VAR.info,
  warning: CHART_TOKEN_VAR.warning,
} as const;

/**
 * Lấy palette resolved tại runtime — cần khi truyền vào lib không hỗ trợ
 * CSS var (vd jsPDF, react-pdf, html2canvas).
 *
 * Tự động re-resolve theo theme hiện tại (light/dark) qua document.
 * SSR-safe: trên server trả về fallback palette light mode.
 */
export function getResolvedChartPalette(): string[] {
  if (typeof window === "undefined" || typeof document === "undefined") {
    // Fallback to light-mode oklch values (sync với globals.css :root section)
    return [
      "oklch(0.43 0.19 263)",
      "oklch(0.620 0.160 145)",
      "oklch(0.700 0.155 50)",
      "oklch(0.650 0.140 310)",
      "oklch(0.620 0.130 160)",
      "oklch(0.580 0.220 25)",
    ];
  }
  const styles = getComputedStyle(document.documentElement);
  return [1, 2, 3, 4, 5, 6].map(
    (i) => styles.getPropertyValue(`--chart-${i}`).trim() || "",
  );
}

/**
 * Lấy 1 slot color resolved (vd cho Recharts `fill` prop).
 *
 * @param slot — 1-6 cho default palette, hoặc semantic key
 */
export function getChartColor(
  slot: 1 | 2 | 3 | 4 | 5 | 6 | keyof typeof CHART_SEMANTIC,
): string {
  if (typeof slot === "number") {
    return CHART_PALETTE[slot - 1] ?? CHART_PALETTE[0];
  }
  return CHART_SEMANTIC[slot];
}
