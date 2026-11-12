import { describe, expect, it } from "vitest";
import { buildDisposalPrintData, buildInternalExportPrintData } from "@/lib/print-templates";

describe("stock work print cost visibility", () => {
  it.each([buildDisposalPrintData, buildInternalExportPrintData])("omits masked amounts instead of printing zero", (build) => {
    const row = {id:"id",code:"X1",date:"2026-11-12",createdBy:"u",status:"draft" as const,statusName:"Phiếu tạm",totalProducts:2,totalAmount:0,reason:"",costVisible:false};
    expect(build(row).summaryRows ?? []).toEqual([]);
    expect((build({...row,costVisible:true}).summaryRows ?? []).map((line) => line.label)).toContain("Tổng giá trị");
  });
});
