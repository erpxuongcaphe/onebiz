import type { WorkingRow } from './workbook-import';
import type { WorkingLibrary } from './working-library';

const fields: (keyof WorkingRow)[] = ['number','group','title','requirement','scope','frequency','dayNumber','monthNumber','points','critical','accountingRequired'];
export type LibraryChange = { key:string; label:string; rowIndex?:number; kind:'added'|'edited'|'removed' };

export function libraryChanges(original:WorkingLibrary, rows:WorkingRow[], removed:number[], title:string, notes:string):LibraryChange[] {
  const changes:LibraryChange[]=[];
  if(title!==original.title)changes.push({key:'title',label:'Tên bộ tiêu chí',kind:'edited'});
  rows.forEach((row,index)=>{
    const before=original.rows[index];
    if(removed.includes(index)){
      if(before)changes.push({key:`row-${index}`,label:`Xóa mục ${before.number}`,rowIndex:index,kind:'removed'});
    }else if(!before)changes.push({key:`row-${index}`,label:`Thêm mục ${row.number}`,rowIndex:index,kind:'added'});
    else if(fields.some(field=>{
      if(row.frequency===before.frequency){
        if(field==='dayNumber'&&['once','daily'].includes(row.frequency))return false;
        if(field==='monthNumber'&&!['quarterly','yearly'].includes(row.frequency))return false;
      }
      return !Object.is(before[field],row[field]);
    }))changes.push({key:`row-${index}`,label:`Sửa mục ${before.number}${before.number===row.number?'':` thành ${row.number}`}`,rowIndex:index,kind:'edited'});
  });
  if(notes!==original.notes)changes.push({key:'notes',label:'Ghi chú bộ tiêu chí',kind:'edited'});
  return changes;
}

export function libraryChangeReason(changes:LibraryChange[], reasons:Record<string,string>):string {
  return changes.map(change=>`${change.label}: ${(reasons[change.key]??'').trim()}`).join('\n');
}

// Keep saved row positions stable so Excel reordering or deletion never moves a reason to another work.
export function reconcileLibraryImport(original:WorkingRow[], imported:WorkingRow[]) {
  const byNumber=new Map(imported.map(row=>[row.number,row]));
  const savedNumbers=new Set(original.map(row=>row.number));
  return {
    rows:[...original.map(row=>byNumber.get(row.number)??{...row}),...imported.filter(row=>!savedNumbers.has(row.number))],
    removed:original.flatMap((row,index)=>byNumber.has(row.number)?[]:[index]),
  };
}
