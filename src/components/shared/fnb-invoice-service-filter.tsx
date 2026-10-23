"use client";
export interface FnbServiceFilterOptions {tables: {label:string;area:string|null}[];areas:string[]}
export function FnbInvoiceServiceFilter({options,table,area,onChange,disabled=false}:{options:FnbServiceFilterOptions;table:string;area:string;onChange:(table:string,area:string)=>void;disabled?:boolean}) {
 const tables=[...new Set(options.tables.filter(t=>!area||t.area===area).map(t=>t.label))];
 return <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto" role="group" aria-label="Lọc bàn và khu vực">
  <select aria-label="Lọc khu vực" disabled={disabled} value={area} onChange={e=>onChange("",e.target.value)} className="min-h-11 min-w-0 sm:min-h-9 rounded-md border bg-background px-2 text-sm text-foreground sm:max-w-52"><option value="">Tất cả khu vực</option>{options.areas.map(name=><option key={name} value={name}>{name}</option>)}</select>
  <select aria-label="Lọc bàn" disabled={disabled} value={table} onChange={e=>onChange(e.target.value,area)} className="min-h-11 min-w-0 sm:min-h-9 rounded-md border bg-background px-2 text-sm text-foreground sm:max-w-52"><option value="">Tất cả bàn</option>{tables.map(name=><option key={name} value={name}>{name}</option>)}</select>
 </div>;
}
