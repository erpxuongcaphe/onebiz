import {describe,it,expect} from "vitest";
import {applyKitchenTemplate} from "@/lib/kitchen-print-template";
import {buildKitchenTicketHtml,buildKitchenTicketBytes,type KitchenTicketDataV2} from "@/lib/print-fnb";

const ticket: KitchenTicketDataV2 = {orderNumber:"KB-123",tableName:"Bàn 5",orderType:"dine_in",createdAt:"2026-10-05T03:30:00Z",stationName:"Bar",
  isOffline:true,isSupplement:true,orderNote:"Không sữa",
  items:[{name:"Cà phê",quantity:2,unitPrice:35000,variant:"L",toppings:[{name:"Kem",quantity:2,price:5000}],modifierLabels:["Đường: 50%"],note:"Đá riêng"}]};

describe("kitchen template used by preview and actual printers",()=>{
  it("applies thermal size, title, font and footer while retaining preparation information",()=>{
    const data = applyKitchenTemplate(ticket,{title:"KHẨN",items:{fontSize:"lg",columns:[]},footer:{customText:"Kiểm tra món"},kitchen:{style:"compact"}},"58mm");
    const html=buildKitchenTicketHtml(data);
    for(const text of ["KHẨN","Kiểm tra món","Bàn 5","Cà phê","Kem x2","Đường: 50%","Đá riêng","Không sữa","CHỜ ĐỒNG BỘ","BỔ SUNG"]) expect(html).toContain(text);
    expect(html).toContain("font-size:22px");
    expect(html).toContain("58mm");
    expect(html).not.toContain('class="price"');
    const bytes=new TextDecoder().decode(buildKitchenTicketBytes(data));
    for(const text of ["KHAN","Kiem tra mon","Ban 5","2x Ca phe (L)","Kem x2","Duong: 50%","Da rieng","Khong sua","CHO DONG BO","BO SUNG"]) expect(bytes).toContain(text);
    expect(bytes).not.toContain("35,000");
  });
  it("escapes arbitrary product, note, title and station content in preview HTML",()=>{
    const html=buildKitchenTicketHtml({...ticket,title:'<script>bad()</script>',stationColor:'red;display:none',stationName:'<img src=x>',orderNote:'<svg onload=bad()>',items:[{...ticket.items[0],name:'<iframe>',note:'<b>note</b>'}]});
    const doc=new DOMParser().parseFromString(html,"text/html");
    expect(doc.querySelector("script,svg,img,iframe")).toBeNull();
    expect(doc.body.textContent).toContain("<iframe>");
    expect(html).not.toContain("display:none");
  });
});
