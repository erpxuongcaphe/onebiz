import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const table = readFileSync(
  resolve("src/components/shared/report/report-data-table.tsx"),
  "utf8",
);
const tableDisplay = readFileSync(
  resolve("src/components/shared/report/report-table-display.tsx"),
  "utf8",
);
const tableFrame = readFileSync(
  resolve("src/components/shared/report/report-table-frame.tsx"),
  "utf8",
);
const lotReport = readFileSync(
  resolve("src/app/(main)/phan-tich/lot-traceability/page.tsx"),
  "utf8",
);
const shiftReport = readFileSync(
  resolve("src/app/(main)/phan-tich/doi-chieu-ca/page.tsx"),
  "utf8",
);

describe("report table display controls", () => {
  it("provides compact, persisted display choices for shared report tables", () => {
    expect(table).toContain("showDisplayOptions = true");
    expect(table).toContain("Hiển thị bảng");
    expect(table).toContain("Mật độ bảng");
    expect(table).toContain("Xuống dòng nội dung dài");
    expect(table).toContain("Cố định cột đầu");
    expect(table).toContain("Kẻ dòng xen kẽ");
    expect(table).toContain("writeReportTablePreferences");
    expect(tableDisplay).toContain("T\\u00ecm c\\u1ed9t");
    expect(tableDisplay).toContain("filteredColumns");
    expect(tableFrame).toContain("disableFreeze={hasMergedCells}");
  });

  it("uses Vietnamese dropdowns for the remaining report filters", () => {
    expect(lotReport).not.toContain("<select");
    expect(lotReport).toContain('aria-label="Trạng thái lô"');
    expect(lotReport).toContain("STATUS_FILTER_OPTIONS");
    expect(shiftReport).toContain('aria-label="Loại đối chiếu"');
    expect(shiftReport).toContain("RECONCILIATION_TYPE_LABELS[type]");
    expect(shiftReport).not.toContain("<SelectValue />");
  });
});
