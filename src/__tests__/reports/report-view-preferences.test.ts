import { beforeEach, describe, expect, it } from "vitest";
import {
  clearReportTablePreferences,
  clearReportViewPreferences,
  readReportTablePreferences,
  readReportViewPreferences,
  writeReportTablePreferences,
  writeReportViewPreferences,
} from "@/lib/reports/preferences";

const REPORT_PATH = "/phan-tich/khach-san-pham";

describe("report view preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores and restores a valid report configuration", () => {
    writeReportViewPreferences(REPORT_PATH, {
      displayMode: "table",
      density: "compact",
      customerColumns: ["revenue", "orders"],
    });

    expect(readReportViewPreferences(REPORT_PATH)).toEqual({
      displayMode: "table",
      density: "compact",
      customerColumns: ["revenue", "orders"],
    });
  });

  it("ignores unknown report paths", () => {
    writeReportViewPreferences("/not-a-report", { density: "compact" });
    expect(readReportViewPreferences("/not-a-report")).toEqual({});
    expect(window.localStorage.length).toBe(0);
  });

  it("clears a saved configuration", () => {
    writeReportViewPreferences(REPORT_PATH, { density: "compact" });
    clearReportViewPreferences(REPORT_PATH);
    expect(readReportViewPreferences(REPORT_PATH)).toEqual({});
  });
});

describe("report table preferences", () => {
  const tableKey = "/phan-tich/ban-hang:date:0|revenue:1";

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores and restores display-only table settings", () => {
    writeReportTablePreferences(tableKey, {
      density: "compact",
      wrapText: false,
      freezeFirstColumn: true,
      stripedRows: false,
      hiddenColumnKeys: ["previous"],
    });

    expect(readReportTablePreferences(tableKey)).toEqual({
      density: "compact",
      wrapText: false,
      freezeFirstColumn: true,
      stripedRows: false,
      hiddenColumnKeys: ["previous"],
    });
  });

  it("ignores invalid keys and clears saved table settings", () => {
    writeReportTablePreferences("", {
      density: "compact",
      wrapText: false,
      freezeFirstColumn: true,
      stripedRows: false,
      hiddenColumnKeys: ["previous"],
    });
    expect(window.localStorage.length).toBe(0);

    writeReportTablePreferences(tableKey, {
      density: "standard",
      wrapText: true,
      freezeFirstColumn: false,
      stripedRows: true,
      hiddenColumnKeys: [],
    });
    clearReportTablePreferences(tableKey);
    expect(readReportTablePreferences(tableKey)).toEqual({});
  });
});
