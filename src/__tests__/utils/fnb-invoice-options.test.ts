import {describe,it,expect} from "vitest";
import {readFnbInvoiceOptions,readFnbInvoiceSize} from "@/lib/utils/fnb-invoice-options";
describe("historical invoice options",()=>{
 it("retains full labels for export and explicit deselection without applying current defaults",()=>{
  const o=readFnbInvoiceOptions([{groupName:"Đá/Nóng",options:[{label:"Đá"}]},{groupName:"Mức ngọt",options:[]},{groupName:"Thêm",options:[{label:"Trân châu"},{label:"Sương sáo"}]}]);
  expect(o.temperature).toBe("Đá");expect(o.sweetness).toBe("Không chọn");expect(o.other).toBe("Thêm: Trân châu / Sương sáo");expect(readFnbInvoiceOptions(null).temperature).toBe("");
 });
 it("only reads original size labels, never guesses from recipe/cup",()=>{
  expect(readFnbInvoiceSize("Matcha Latte")).toBe("");expect(readFnbInvoiceSize("Bạc Sỉu (Size L)")).toBe("Size L");expect(readFnbInvoiceSize("Bạc Sỉu (Size M)","Size L")).toBe("Size L");
 });
 it("ignores malformed option records safely",()=>{expect(readFnbInvoiceOptions([null,{groupName:1},{groupName:"X",options:[{label:null}]}]).temperature).toBe("");});
});
