import {describe,it,expect} from "vitest";
import * as XLSX from "xlsx";
import {parseWorkbook} from "@/lib/excel/template-parser";
import {initialStockExcelSchema} from "@/lib/excel/schemas/initial-stock";

const headers=initialStockExcelSchema.columns.map(c=>c.header);
const row=["SKU-TRA-001","Hồng trà","CNH-XTB",0,0,"","Túi","",""];
function workbook(data: unknown[][], sheetName="Dữ liệu") {
 const wb=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(data),sheetName);
 return wb;
}

describe("opening stock header recognition",()=>{
 it("reads the Onebiz template layout and keeps explicit zeros distinct from missing data",()=>{
  const result=parseWorkbook(workbook([headers,row]),initialStockExcelSchema);
  expect(result.tableErrors).toEqual([]);
  expect(result.errorRows).toEqual([]);
  expect(result.validRows).toEqual([expect.objectContaining({productCode:"SKU-TRA-001",branchCode:"CNH-XTB",quantity:0,costPrice:0})]);
 });
 it("accepts equivalent accent encoding, case, spaces and line breaks without changing codes or values",()=>{
  const copied=headers.map(h=>h.normalize("NFD").toUpperCase().replace(/ /g,"  \n "));
  const result=parseWorkbook(workbook([copied,row]," DỮ LIỆU "),initialStockExcelSchema);
  expect(result.tableErrors).toEqual([]);
  expect(result.errorRows).toEqual([]);
  expect(result.validRows[0]).toMatchObject({productCode:"SKU-TRA-001",quantity:0,costPrice:0});
 });
 it("recognizes data sheet spelling variants even when the instructions sheet is first",()=>{
  const wb=workbook([["Không nhập ở đây"]],"Hướng dẫn");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([headers,row])," DỮ LIỆU ".normalize("NFD"));
  expect(parseWorkbook(wb,initialStockExcelSchema).validRows).toHaveLength(1);
 });
 it("finds headers after title/blank rows and reports the actual Excel row for incomplete values",()=>{
  const missing: unknown[]=[...row];missing[4]=null;
  const result=parseWorkbook(workbook([["Tồn đầu kỳ"],[],headers,[],missing]),initialStockExcelSchema);
  expect(result.tableErrors).toEqual([]);
  expect(result.validRows).toEqual([]);
  expect(result.errorRows[0].rowIndex).toBe(5);
  expect(result.errorRows[0].errors).toContain('Thiếu giá trị cho "Giá vốn"');
 });
 it("still blocks genuinely missing columns and explains which sheet and header row was read",()=>{
  const result=parseWorkbook(workbook([headers.filter(h=>h!=="Giá vốn"),row.filter((_,i)=>i!==4)]),initialStockExcelSchema);
  expect(result.tableErrors.some(e=>e.includes('Thiếu cột bắt buộc "Giá vốn"'))).toBe(true);
  expect(result.tableErrors.some(e=>e.includes('tiêu đề dòng 1'))).toBe(true);
  expect(result.validRows).toEqual([]);
 });
 it("blocks visually duplicate headers instead of guessing which quantity to import",()=>{
  const result=parseWorkbook(workbook([[...headers," SỐ  LƯỢNG "],[...row,100]]),initialStockExcelSchema);
  expect(result.tableErrors.some(e=>e.includes('Cột "Số lượng" bị lặp'))).toBe(true);
 });
 it("does not change strict header matching for other import schemas",()=>{
  const strict={...initialStockExcelSchema,normalizeHeaders:undefined,headerRowSearchLimit:undefined};
  const result=parseWorkbook(workbook([headers.map(h=>h.toUpperCase()),row]),strict);
  expect(result.tableErrors.length).toBeGreaterThan(0);
 });
});

it("keeps the first complete required header instead of skipping earlier data for a later full header",()=>{
 const required=["Mã SP","Mã chi nhánh","Số lượng","Giá vốn"];
 const result=parseWorkbook(workbook([required,["SKU-TRA-001","CNH-XTB",2,125000],headers,row]),initialStockExcelSchema);
 expect(result.validRows[0]).toMatchObject({productCode:"SKU-TRA-001",quantity:2,costPrice:125000});
 expect(result.errorRows.some(r=>r.rowIndex===3)).toBe(true);
});
