"use client";
import {useEffect,useRef,useState} from "react";
import type {PaperSize} from "@/lib/print-document";

/** Keep the document's real viewport width; scale its display to the editor. */
export function PrintHtmlPreview({html,paperSize,title,height=520}:{html:string;paperSize:PaperSize;title:string;height?:number}) {
  const container=useRef<HTMLDivElement>(null);
  const [available,setAvailable]=useState(0);
  const width=Math.ceil((paperSize==="58mm"?58:paperSize==="80mm"?80:paperSize==="A5"?148:210)/25.4*96);
  useEffect(()=>{
    const element=container.current;if(!element)return;
    const resize=()=>setAvailable(element.clientWidth);
    resize();const observer=new ResizeObserver(resize);observer.observe(element);
    return ()=>observer.disconnect();
  },[]);
  const scale=available?Math.min(1,available/width):1;
  return <div ref={container} className="w-full overflow-hidden" style={{height}}>
    <iframe title={title} srcDoc={html} sandbox="allow-same-origin" className="block border bg-white" style={{width,height:height/scale,transform:`scale(${scale})`,transformOrigin:"top left",marginLeft:available?Math.max(0,(available-width*scale)/2):0}} />
  </div>;
}
