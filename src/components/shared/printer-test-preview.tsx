"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { generateDocumentHtml, type PaperSize } from "@/lib/print-document";
import { PrintHtmlPreview } from "@/components/shared/print-html-preview";

export function PrinterTestPreview({paperSize}: {paperSize:PaperSize}) {
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [image,setImage]=useState("");
  const html=generateDocumentHtml({documentType:"IN THỬ ONEBIZ",documentCode:"TEST-DEMO",date:"2026-10-06T10:30:00+07:00",businessName:"DỮ LIỆU MINH HỌA",headerFields:[{label:"Bàn",value:"Bàn 5"}],items:[{name:"Cà phê sữa đá — Size L",quantity:2,unitPrice:35000,total:70000,note:"Đường: 70% • Đá: ít • Pha nhạt, đá riêng"},{name:"Bạc xỉu",quantity:1,unitPrice:32000,total:32000}],summaryRows:[{label:"Tổng thanh toán",value:"102.000 đ",bold:true}],showSignature:false,note:"Đây là bản thử, không tạo giao dịch và không gửi tới máy in."},paperSize);
  const render = async () => {
    if(paperSize !== "58mm" && paperSize !== "80mm") return;
    setBusy(true);setMessage("");setImage("");
    try {
      const {renderPrintRaster,encodeRaster}=await import("@/lib/printer/raster-print");
      const canvas=await renderPrintRaster(html,paperSize);const ctx=canvas.getContext("2d");
      if(!ctx) throw new Error("Không dựng được ảnh.");
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      encodeRaster(canvas.width,canvas.height,pixels.data);
      for(let i=0;i<pixels.data.length;i+=4){const alpha=pixels.data[i+3]/255;const lightness=(0.299*pixels.data[i]+0.587*pixels.data[i+1]+0.114*pixels.data[i+2])*alpha+255*(1-alpha);const value=lightness<160?0:255;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;pixels.data[i+3]=255;}
      ctx.putImageData(pixels,0,0);setImage(canvas.toDataURL("image/png"));setMessage("Đã dựng được ảnh USB. Kiểm tra đủ dấu tiếng Việt và ghi chú; vẫn cần in thử giấy khi gắn máy.");
    }catch(error){setMessage(`Chưa dựng được ảnh USB: ${error instanceof Error?error.message:"Hãy dùng in qua trình duyệt."}`);}
    finally{setBusy(false);}
  };
  return <>
    <Button variant="outline" onClick={()=>{setMessage("");setImage("");setOpen(true);}}>Xem trước in thử</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-primary">Bản thử {paperSize}</DialogTitle><DialogDescription>Dữ liệu minh họa. Xem trước và kiểm tra ảnh không gửi lệnh tới máy in.</DialogDescription></DialogHeader>
        <PrintHtmlPreview title="Bản thử theo khổ giấy" html={html} paperSize={paperSize} height={400} />
        {image && <div><p className="text-sm font-semibold text-primary">Ảnh sẽ gửi qua USB</p>
          {/* Locally generated data URI; no remote image optimization needed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="Ảnh in USB đen trắng, đủ dấu tiếng Việt" className="mx-auto max-w-full border" style={{width:paperSize==="58mm"?219:302}} />
        </div>}
        {message&&<p role="status" className="text-sm">{message}</p>}
        <DialogFooter className="sticky bottom-0 bg-background py-2">
          {(paperSize==="58mm"||paperSize==="80mm")&&<Button disabled={busy} onClick={render}>{busy?"Đang kiểm tra…":"Kiểm tra bản in USB"}</Button>}
          <Button variant="outline" onClick={()=>setOpen(false)}>Đóng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
