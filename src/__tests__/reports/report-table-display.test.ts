import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const table = readFileSync(
  resolve("src/components/shared/report/report-data-table.tsx"),
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
    expect(table).toContain("Hiá»ƒn thá»‹ báº£ng");
    expect(table).toContain("Máº­t Ä‘á»™ báº£ng");
    expect(table).toContain("Xuá»‘ng dÃ²ng ná»™i dung dÃ i");
    expect(table).toContain("Cá»‘ Ä‘á»‹nh cá»™t Ä‘áº§u");
    expect(table).toContain("Káº» dÃ²ng xen káº½");
    expect(table).toContain("writeReportTablePreferences");
  });

  it("uses Vietnamese dropdowns for the remaining report filters", () => {
    expect(lotReport).not.toContain("<select");
    expect(lotReport).toContain('aria-label="Tráº¡ng thÃ¡i lÃ´"');
    expect(lotReport).toContain("STATUS_FILTER_OPTIONS");
    expect(shiftReport).toContain('aria-label="Loáº¡i Ä‘á»‘i chiáº¿u"');
    expect(shiftReport).toContain("RECONCILIATION_TYPE_LABELS[type]");
    expect(shiftReport).not.toContain("<SelectValue />");
  });
});

