type Choice={groupName:string;options:{label:string}[]};
export function readFnbInvoiceOptions(value:unknown) {
 const groups:Choice[]=Array.isArray(value)?value.flatMap(raw=>{
  if(!raw || typeof raw!=="object" || typeof raw.groupName!=="string" || !Array.isArray(raw.options))return [];
  return [{groupName:raw.groupName,options:raw.options.filter((o:unknown):o is {label:string}=>!!o&&typeof o==="object"&&typeof (o as {label?:unknown}).label==="string")}];
 }):[];
 const isSweetness=(name:string)=>name==="Mức ngọt"||name.startsWith("Mức ngọt - ");
 const values=(name:string)=>groups.filter(g=>g.groupName===name||(name==="Mức ngọt"&&isSweetness(g.groupName))).map(g=>g.options.length?g.options.map(o=>o.label).join(" / "):"Không chọn").join(" / ");
 const temperature=values("Đá/Nóng"),sweetness=values("Mức ngọt"),ice=values("Mức đá");
 const other=groups.filter(g=>!["Đá/Nóng","Mức đá"].includes(g.groupName)&&!isSweetness(g.groupName)).map(g=>`${g.groupName}: ${g.options.length?g.options.map(o=>o.label).join(" / "):"Không chọn"}`).join(" · ");
 const summary=[temperature,sweetness?`Ngọt: ${sweetness.replace(/\s*\(bình thường\)/g,"")}`:"",ice,other].filter(Boolean).join(" · ");
 const full=groups.map(g=>`${g.groupName}: ${g.options.length?g.options.map(o=>o.label).join(" / "):"Không chọn"}`).join(" · ");
 return {temperature,sweetness,ice,other,summary,full};
}

/** Only a recorded label or the original invoice-name suffix; never today's menu/default cup. */
export function readFnbInvoiceSize(name:string,recorded?:string|null) {
 if(recorded?.trim())return recorded.trim();
 return name.match(/\((Size [^()]+|Nóng Nhỏ)\)$/i)?.[1]??"";
}
export function invoiceNameWithoutSize(name:string,size:string) {
 const suffix=` (${size})`;return size&&name.endsWith(suffix)?name.slice(0,-suffix.length):name;
}
