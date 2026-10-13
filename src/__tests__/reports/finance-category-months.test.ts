import { describe, expect, it } from "vitest";
import { financeCategoryMonths } from "@/lib/reports/finance-category-months";
import type { FinanceEvent } from "@/lib/services/supabase/management-finance";
const event: FinanceEvent = {id:"one",code:"CP1",counterparty:"Điện lực",note:null,created_by_name:"Admin",kind:"expense",category_code:"CP-DIEN",category_name:"Điện",business_date:"2026-10-12",amount:300,
  status:"posted",settled_amount:300,report_amount:300,settlements:[],allocations:[
    {branch_id:"A",branch_name:"A",recognition_date:"2026-09-30",amount:100},
    {branch_id:"B",branch_name:"B",recognition_date:"2026-10-01",amount:200},
  ]};
describe("monthly recognition matrix", () => {
  it("uses allocation date, not payment or document creation date", () => {
    const matrix=financeCategoryMonths([event],"2026-09-01","2026-10-31");
    expect(matrix.months).toEqual(["2026-09","2026-10"]);
    expect(matrix.rows[0]).toMatchObject({total:300,values:{"2026-09":100,"2026-10":200}});
  });
  it("does not copy the full event into every branch", () => {
    expect(financeCategoryMonths([event],"2026-09-01","2026-10-31","A").rows[0].total).toBe(100);
  });
  it("excludes cancelled recognition while keeping the source untouched", () => {
    expect(financeCategoryMonths([{...event,status:"cancelled"}],"2026-09-01","2026-10-31").rows).toEqual([]);
    expect(event.status).toBe("posted");
  });
  it("rejects duplicate source events", () => {
    expect(()=>financeCategoryMonths([event,event],"2026-09-01","2026-10-31")).toThrow("bị trùng");
  });
  it("handles year transitions and the final valid calendar year finitely",()=>{
    expect(financeCategoryMonths([],"2026-12-01","2027-01-31").months).toEqual(["2026-12","2027-01"]);
    expect(financeCategoryMonths([],"9999-12-01","9999-12-31").months).toEqual(["9999-12"]);
  });
});
