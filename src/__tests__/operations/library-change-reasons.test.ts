import { describe,expect,it } from 'vitest';
import { libraryChanges,libraryChangeReason,reconcileLibraryImport } from '@/lib/operations/library-change-reasons';
import { ceoWorkingRows } from '@/lib/operations/workbook-import';
import type { WorkingLibrary } from '@/lib/operations/working-library';

const original:WorkingLibrary={id:'test',title:'Bộ CEO',version:2,rows:ceoWorkingRows.map(row=>({...row})),notes:'Ghi chú',source_key:null,archived:false,updated_at:''};
describe('inline working library change reasons',()=>{
 it('does not ask for a reason when nothing changed or a change was reverted',()=>{
  expect(libraryChanges(original,original.rows,[],original.title,original.notes)).toEqual([]);
  const rows=original.rows.map(row=>({...row})); rows[32].title='Nội dung mới'; rows[32].title=original.rows[32].title;
  expect(libraryChanges(original,rows,[],original.title,original.notes)).toEqual([]);
 });
 it('keeps the changed work identity stable when its STT also changes',()=>{
  const rows=original.rows.map(row=>({...row})); rows[32]={...rows[32],number:88,dayNumber:5};
  const changes=libraryChanges(original,rows,[],original.title,original.notes);
  expect(changes).toEqual([{key:'row-32',label:'Sửa mục 33 thành 88',rowIndex:32,kind:'edited'}]);
  expect(libraryChangeReason(changes,{'row-32':'  Đổi ngày kiểm kho  '})).toBe('Sửa mục 33 thành 88: Đổi ngày kiểm kho');
 });
 it('records multiple edits, deletion and metadata without changing original data',()=>{
  const before=JSON.stringify(original);const rows=original.rows.map(row=>({...row})); rows[0].points=-10;
  const changes=libraryChanges(original,rows,[32],'Tên mới','Ghi chú mới');
  expect(changes.map(change=>change.key)).toEqual(['title','row-0','row-32','notes']);
  expect(changes.find(change=>change.key==='row-32')?.kind).toBe('removed');
  expect(JSON.stringify(original)).toBe(before);
 });
 it('ignores removed unsaved additions and preserves added rows that remain',()=>{
  const rows=[...original.rows,{...original.rows[0],number:35}];
  expect(libraryChanges(original,rows,[34],original.title,original.notes)).toEqual([]);
  expect(libraryChanges(original,rows,[],original.title,original.notes)[0].kind).toBe('added');
 });
 it('reconciles reordered Excel rows by saved STT, retains deletions and identifies additions',()=>{
  const imported=[{...original.rows[32],title:'Hàng tồn kho mới'},{...original.rows[0]},{...original.rows[0],number:35}];
  const draft=reconcileLibraryImport(original.rows,imported);
  expect(draft.rows[32].title).toBe('Hàng tồn kho mới');expect(draft.rows[0].number).toBe(1);
  expect(draft.removed).not.toContain(32);expect(draft.removed).toContain(31);
  expect(draft.rows.at(-1)?.number).toBe(35);
 });
 it('preserves long reasons for explicit validation instead of truncating audit data',()=>{
  const changes=libraryChanges(original,[{...original.rows[0],title:'Sửa'}],[],original.title,original.notes);
  expect(libraryChangeReason(changes,{'row-0':'x'.repeat(1000)})).toHaveLength(1011);
 });
});
