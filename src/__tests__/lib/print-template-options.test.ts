import {describe,it,expect,vi} from "vitest";
vi.mock("@/lib/services",()=>({resolvePrintTemplate:vi.fn(),getResolvedBrand:vi.fn()}));
import {applyTemplateToDocData} from "@/lib/print-apply-template";
import {generateDocumentHtml,type DocumentPrintData} from "@/lib/print-document";
const base:DocumentPrintData={documentType:"Bill",documentCode:"HD1",date:"2026-10-06T10:30:00+07:00",headerFields:[{label:"Khách hàng",value:"Nguyễn An"}],items:[{code:"CF1",name:"Cà phê sữa đá",quantity:2,unitPrice:35000,total:70000,note:"Đá ít"}],itemColumns:["Mã hàng","Tên hàng","SL","Đơn giá","Thành tiền"],summaryRows:[{label:"Giảm giá",value:"5.000 đ"},{label:"Tổng thanh toán",value:"65.000 đ"},{label:"Khách còn phải trả",value:"10.000 đ"}],qrImageUrl:"https://example.com/qr.png"};
describe("template flags affect real thermal output",()=>{
  it("does not restore the default thank-you when the template hides it",()=>{
    const data=applyTemplateToDocData({...base,businessFooter:"Hẹn gặp lại"},{brand:{},config:{footer:{thankYou:false}}});
    const html=generateDocumentHtml(data,"58mm");expect(html).not.toContain("Cảm ơn Quý khách!");expect(html).not.toContain("Hẹn gặp lại");
  });
  it.each(["58mm","80mm"] as const)("hides optional price without printing zero on %s",paper=>{
    const out=applyTemplateToDocData(base,{brand:{},config:{items:{columns:["name","qty","total"]},payment:{showQr:false,showDiscount:false,showDebt:false},customer:{name:false}}});
    const html=generateDocumentHtml(out,paper);
    expect(html).toContain("Cà phê sữa đá");expect(html).toContain("Đá ít");expect(html).not.toContain("× 0");expect(html).not.toMatch(/35[.,]000/);expect(html).not.toContain("Giảm giá");expect(html).not.toContain("Khách còn phải trả");expect(html).not.toContain("Nguyễn An");expect(html).not.toContain("example.com/qr");expect(html).toContain("65.000");
    expect(base.items?.[0].unitPrice).toBe(35000);expect(base.summaryRows).toHaveLength(3);
  });
  it("keeps mandatory name, quantity and total even for an empty legacy column selection",()=>{
    const out=applyTemplateToDocData(base,{brand:{},config:{items:{columns:[]}}});
    expect(out.itemColumns).toEqual(["Tên hàng","SL","Thành tiền"]);expect(out.items?.[0]).toMatchObject({name:"Cà phê sữa đá",quantity:2,total:70000});
  });
  it("shows selected product code and price in thermal receipts",()=>{
    const out=applyTemplateToDocData(base,{brand:{},config:{items:{columns:["code","name","qty","price","total"]}}});
    const html=generateDocumentHtml(out,"58mm");expect(html).toContain("CF1 · Cà phê sữa đá");expect(html).toMatch(/× 35[.,]000/);
  });
});
