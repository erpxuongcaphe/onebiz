import { describe, expect, it } from 'vitest';
import { searchOptions } from '@/lib/search-options';
const fields=(x:{name:string;code:string})=>({name:x.name,identifiers:[x.code]});
describe('entity suggestion ranking',()=>{
 it('places literal code, exact name, partial and typo matches in that order',()=>{
  const rows=[{name:'Sữa đak',code:'A'},{name:'Sữa đặc Lamosa',code:'B'},{name:'Sữa đặc',code:'C'},{name:'Khác',code:'sua dac'}];
  expect(searchOptions(rows,'sua dac',fields).map(r=>r.item.code)).toEqual(['sua dac','C','B','A']);
 });
 it('preserves all choices when empty, does not cap at 100 or 500',()=>{
  const rows=Array.from({length:2001},(_,i)=>({name:`Tên ${i}`,code:`SKU-${i}`}));
  expect(searchOptions(rows,'',fields)).toHaveLength(2001);
  expect(searchOptions(rows,'SKU-2000',fields)[0].item.code).toBe('SKU-2000');
 });
 it('handles diacritics, reversed words and transpositions without changing source',()=>{
  const rows=[{name:'Sữa Đặc',code:'NVL-001'}];
  for(const q of ['dac sua','sưã đạc','sau dac'])expect(searchOptions(rows,q,fields)[0].item).toBe(rows[0]);
 });
 it.each(['NVL-002','0901234568',"%'_"])('does not suggest another identifier for %s',q=>{
  expect(searchOptions([{name:'Sữa Đặc',code:'NVL-001'}],q,fields)).toEqual([]);
 });
});
