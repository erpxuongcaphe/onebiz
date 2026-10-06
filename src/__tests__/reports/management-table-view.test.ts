import { describe, it, expect } from "vitest";
import { cashReportRows, customerReportRows, cogsReportRows, debtorReportRows, type CashTableFilter } from "@/lib/reports/management-table-view";
import type { CashBookEntry } from "@/lib/types";
const filters: CashTableFilter = { search: "", type: "all", category: "", method: "", min: "", max: "", sort: "amount", direction: "desc" };
const rows: CashBookEntry[] = Array.from({ length: 65 }, (_, index) => ({ id: String(index), code: `PT${index}`, date: "2026-10-06", type: "receipt", typeName: "Thu", category: "other", counterparty: "Client", amount: index, createdBy: "user", paymentMethod: "cash" }));
describe("management report full-result views", () => {
  it("filters and sorts all pages without mutating input", () => {
    const result = cashReportRows(rows, { ...filters, min: "50" });
    expect(result).toHaveLength(15);
    expect(result[0].amount).toBe(64);
    expect(rows[0].amount).toBe(0);
  });
  it("combines method, category, type and reference/person search", () => {
    const entry = { ...rows[0], performedByName: "Lan", referenceCode: "HD001", amount: 10 };
    expect(cashReportRows([entry], { ...filters, search: "lan", category: "other", method: "cash", type: "receipt", min: "0", max: "10" })).toHaveLength(1);
    expect(cashReportRows([entry], { ...filters, search: "hd001" })).toHaveLength(1);
    expect(cashReportRows([entry], { ...filters, type: "payment" })).toHaveLength(0);
  });
  it("rejects invalid amount ranges instead of treating them as zero", () => {
    for (const min of ["bad", "-1", "100"]) expect(cashReportRows(rows, { ...filters, min, max: "10" })).toEqual([]);
  });
  it("sorts both ways and includes zero-value receipts", () => {
    expect(cashReportRows(rows, { ...filters, direction: "asc" })[0].amount).toBe(0);
  });
  it("includes every matching customer and handles zero orders safely", () => {
    const customers = Array.from({ length: 70 }, (_, i) => ({ customerId: String(i), rank: i + 1, name: `Customer ${i}`, orders: i, revenue: i * 10 }));
    expect(customerReportRows(customers, "customer", "revenue", "desc")).toHaveLength(70);
    expect(customerReportRows(customers, "", "average", "asc")[0].customerId).toBe("0");
    expect(customers[0].customerId).toBe("0");
  });
  it("filters customer codes and groups without matching duplicate names incorrectly", () => {
    const customers = [{ customerId: "1", rank: 1, name: "Lan", code: "KSI-001", groupName: "Wholesale", orders: 1, revenue: 100 }, { customerId: "2", rank: 2, name: "Lan", code: "KLE-001", orders: 1, revenue: 10 }];
    expect(customerReportRows(customers, "ksi", "code", "asc", "Wholesale").map(row => row.customerId)).toEqual(["1"]);
    expect(customerReportRows(customers, "", "revenue", "asc", "Chưa phân nhóm").map(row => row.customerId)).toEqual(["2"]);
  });
  it("keeps unknown costs last in both sort directions and filters missing separately", () => {
    const cogs = [{ productName: "Unknown", qtySold: 1, costPrice: 0, totalCost: 0, pctOfCogs: 0, costComplete: false, missingCostLines: 1 }, { productName: "Known", qtySold: 1, costPrice: 10, totalCost: 10, pctOfCogs: 100, costComplete: true, missingCostLines: 0 }];
    for (const direction of ["asc", "desc"] as const) expect(cogsReportRows(cogs, "", "all", "totalCost", direction)[0].productName).toBe("Known");
    expect(cogsReportRows(cogs, "", "missing", "productName", "asc")).toHaveLength(1);
  });
  it("filters the current debt snapshot independently of period sales", () => {
    expect(debtorReportRows([{ name: "Lan", debt: 10 }, { name: "Mai", debt: 20 }], "", "debt", "desc")[0].name).toBe("Mai");
    expect(debtorReportRows([{ name: "Lan", debt: 10 }], "mai", "name", "asc")).toEqual([]);
  });
});
