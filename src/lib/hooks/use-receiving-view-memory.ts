"use client";

import {useEffect,useRef,useState} from 'react';
import type {ZodType} from 'zod';
import {receivingVietnamDay} from '@/lib/receiving-view-state';

const TTL=24*60*60*1000;
function scrollOwner(element:HTMLElement|null):HTMLElement|Window {
  for(let parent=element?.parentElement;parent;parent=parent.parentElement) {
    if(/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return window;
}

// Only view preferences are persisted, never receipt drafts or business records.
export function useReceivingViewMemory<T>({key,snapshot,initial,schema,restore,loading}:{
  key:string|undefined;snapshot:T;initial:T;schema:ZodType<T>;restore:(value:T)=>void;loading:boolean;
}) {
  const containerRef=useRef<HTMLDivElement>(null);
  const latest=useRef({initial,schema,restore});
  useEffect(()=>{latest.current={initial,schema,restore};},[initial,schema,restore]);
  const [restoredKey,setRestoredKey]=useState<string|null>(null);
  const identity=key??'transient';
  const ready=restoredKey===identity;
  const pendingScroll=useRef<number|null>(0);
  const scroll=useRef(0);

  useEffect(()=>{
    let value=latest.current.initial,top=0;
    if(key) try {
      const saved=JSON.parse(sessionStorage.getItem(key)??'null');
      const parsed=latest.current.schema.safeParse(saved?.data);
      if(saved?.version===1&&saved.expiresAt>Date.now()&&parsed.success) {
        value=parsed.data;
        top=typeof saved.scroll==='number'&&Number.isFinite(saved.scroll)?Math.max(0,Math.min(saved.scroll,10000000)):0;
      }
    } catch { /* Storage is optional; receiving must remain usable. */ }
    scroll.current=top;pendingScroll.current=top;
    latest.current.restore(value);
    setRestoredKey(identity);
  },[key,identity]);

  useEffect(()=>{
    if(!ready||!key) return;
    const persist=()=>{
      const parsed=latest.current.schema.safeParse(snapshot);
      if(!parsed.success) return;
      try {sessionStorage.setItem(key,JSON.stringify({version:1,expiresAt:Date.now()+TTL,data:parsed.data,scroll:scroll.current}));} catch { /* Ignore storage quota/privacy restrictions. */ }
    };
    persist();
    const owner=scrollOwner(containerRef.current);
    const remember=()=>{scroll.current=owner===window?window.scrollY:(owner as HTMLElement).scrollTop;persist();};
    owner.addEventListener('scroll',remember,{passive:true});
    return ()=>{owner.removeEventListener('scroll',remember);};
  },[key,ready,snapshot]);

  useEffect(()=>{
    if(!ready||loading||pendingScroll.current===null) return;
    const frame=requestAnimationFrame(()=>{
      const top=pendingScroll.current;
      if(top===null) return;
      const owner=scrollOwner(containerRef.current);
      if(owner===window) window.scrollTo({top,behavior:'instant'});
      else (owner as HTMLElement).scrollTop=top;
      pendingScroll.current=null;
    });
    return ()=>cancelAnimationFrame(frame);
  },[ready,loading]);
  return {ready,containerRef};
}

export function useReceivingVietnamDay() {
  const [day,setDay]=useState(receivingVietnamDay);
  useEffect(()=>{
    const refresh=()=>setDay(receivingVietnamDay());
    const timer=setInterval(refresh,60000);
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[]);
  return day;
}
