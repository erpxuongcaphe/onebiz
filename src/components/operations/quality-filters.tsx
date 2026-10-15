"use client";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import s from "./quality.module.css";

const query = "(max-width: 640px)";
function subscribe(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
const getMobile = () => window.matchMedia(query).matches;
const getServerMobile = () => false;

export function QualityFilters({ children, activeCount }: { children: ReactNode; activeCount: number }) {
  const mobile = useSyncExternalStore(subscribe, getMobile, getServerMobile);
  const [open, setOpen] = useState(false);
  if (!mobile) return <section className={s.filters} aria-label="Bộ lọc công việc">{children}</section>;
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-expanded={open} className={s.filterTrigger}>
      <Icon name="filter_list" size={18}/>Bộ lọc{activeCount ? ` (${activeCount})` : ""}
    </button>
    <Dialog open={open} onOpenChange={setOpen} protectUnsavedChanges={false}>
      <DialogContent className={s.dialog} showCloseButton={false}>
        <div className={s.dialogHeader}><DialogTitle>Lọc công việc</DialogTitle><button type="button" aria-label="Đóng bộ lọc" onClick={() => setOpen(false)}><Icon name="close" size={20}/></button></div>
        <div className={s.dialogBody}>{children}</div>
        <div className={s.dialogFooter}><button type="button" className={s.primary} onClick={() => setOpen(false)}>Xem kết quả</button></div>
      </DialogContent>
    </Dialog>
  </>;
}
