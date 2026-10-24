import {render,renderHook,act,screen,cleanup} from "@testing-library/react";
import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {useInvoiceDisplay,DEFAULT_INVOICE_DISPLAY,parseInvoiceDisplay} from "@/lib/hooks/use-invoice-display";
import {fnbItemColumns,FnbInvoiceItemLabel,FnbInvoiceMobileItem} from "@/components/shared/fnb-invoice-items";
vi.mock("@/lib/services/supabase/invoice-display-preferences",()=>({getInvoiceDisplayPreferences:()=>new Promise(()=>{}),saveInvoiceDisplayPreferences:vi.fn()}));
const item={productName:"Xưởng Bạc Sỉu (Size L)",variantLabel:"Size L",productCode:"SKU-007",quantity:2,unit:"Ly",unitPrice:25000,total:50000,note:"Để riêng",fnbOptions:[{groupName:"Đá/Nóng",options:[{label:"Đá"}]},{groupName:"Mức ngọt - Hồng Trà",options:[{label:"100%"}]},{groupName:"Mức đá",options:[{label:"Ít đá"}]}]};
beforeEach(()=>localStorage.clear());afterEach(()=>{cleanup();vi.restoreAllMocks()});
describe("shared invoice display",()=>{
 it("defaults to four compact columns while keeping all choices and notes readable",()=>{
  expect(fnbItemColumns().map(c=>c.header)).toEqual(["Tên món","SL","Đơn giá","Thành tiền"]);
  render(<FnbInvoiceItemLabel item={item}/>);expect(screen.getByText(/Size L · Đá · Ngọt: 100% · Mức đá: Ít đá/)).toBeTruthy();expect(screen.getByText("Ghi chú: Để riêng")).toBeTruthy();
 });
 it("splits only the requested fields, and mobile keeps the same choices readable",()=>{
  const display={...DEFAULT_INVOICE_DISPLAY,splitOptions:true,hiddenFields:["Mã hàng","ĐVT","Giảm","Mức đá"]};
  const headers=fnbItemColumns(display).map(c=>c.header);expect(headers).toContain("Size");expect(headers).toContain("Mức ngọt");expect(headers).not.toContain("Mức đá");
  render(<FnbInvoiceMobileItem item={item} display={display}/>);expect(screen.getByText(/Size L · Đá · Ngọt: 100%/)).toBeTruthy();expect(screen.queryByText(/Ít đá/)).toBeNull();expect(screen.queryByText(/SKU-007/)).toBeNull();
 });
 it("remembers across bill remounts and reloads, isolates accounts and tenants",()=>{
  const first=renderHook(()=>useInvoiceDisplay("tenant-a","user-a"));const next={...DEFAULT_INVOICE_DISPLAY,splitOptions:true,listColumns:{customerName:false}};
  act(()=>first.result.current[1](next));first.unmount();
  const restored=renderHook(({tenant,user})=>useInvoiceDisplay(tenant,user),{initialProps:{tenant:"tenant-a",user:"user-a"}});
  expect(restored.result.current[0]).toEqual(next);restored.rerender({tenant:"tenant-a",user:"user-b"});expect(restored.result.current[0]).toEqual(DEFAULT_INVOICE_DISPLAY);
  restored.rerender({tenant:"tenant-b",user:"user-a"});expect(restored.result.current[0]).toEqual(DEFAULT_INVOICE_DISPLAY);restored.rerender({tenant:"tenant-a",user:"user-a"});expect(restored.result.current[0]).toEqual(next);
 });
 it("does not crash when stored data is malformed or storage is blocked",()=>{
  localStorage.setItem("onebiz:invoice-display:v1:t:u","broken");const view=renderHook(()=>useInvoiceDisplay("t","u"));expect(view.result.current[0]).toEqual(DEFAULT_INVOICE_DISPLAY);
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("blocked")});act(()=>view.result.current[1]({...DEFAULT_INVOICE_DISPLAY,splitOptions:true}));expect(view.result.current[0].splitOptions).toBe(true);
 });
 it("validates unknown fields",()=>{
  expect(parseInvoiceDisplay({hiddenFields:["anything",42,"Size"],listColumns:{valid:false,invalid:"x"}})).toEqual({splitOptions:false,hiddenFields:["Size"],listColumns:{valid:false}});
 });
 it("never mutates recorded quantities, choices or bill money when hiding fields",()=>{
  const original=JSON.stringify(item);fnbItemColumns({...DEFAULT_INVOICE_DISPLAY,hiddenFields:["Size","Đá/Nóng"]}).forEach(c=>{if(typeof c.accessor==="function")c.accessor(item)});expect(JSON.stringify(item)).toBe(original);
 });
});
