import { describe,expect,it } from 'vitest';
import { normalizeSearch,oneEditApart,rankSearchMatch } from '@/lib/smart-search';
describe('smart search ranking contract',()=>{
 it.each(['Sữa Đặc','Sua Dac','sưã đạc','Su\u031b\u0303a Đa\u0323\u0306c'])('normalizes Vietnamese %s',q=>expect(normalizeSearch(q)).toBe('sua dac'));
 it.each([['sua','sau'],['dac','dak'],['dac','dacc'],['dac','dc']])('allows a single word edit %s/%s',(a,b)=>expect(oneEditApart(a,b)).toBe(true));
 it('ranks literal identifiers before names',()=>expect(rankSearchMatch('Tên khác',['SKU-A','012345'],'sku-a')).toBe('identifier'));
 it('ranks normalized names before partial names',()=>expect(rankSearchMatch('Sữa đặc',['SKU-A'],'sua dac')).toBe('name'));
 it('accepts omitted words and arbitrary word order',()=>expect(rankSearchMatch('Sữa đặc Lamosa 1kg',['SKU-A'],'lamosa sua')).toBe('partial'));
 it('labels light name typos as near, never selects a product',()=>expect(rankSearchMatch('Sữa đặc Lamosa',['SKU-A'],'sau dak')).toBe('near'));
 it('supports a three-letter Vietnamese word transposition',()=>expect(rankSearchMatch('Sữa đặc',['SKU-A'],'sau')).toBe('near'));
 it.each(['SKU-B','012346','2509','',"%'_",'a '.repeat(9)])('does not fuzzy-correct identifiers, punctuation or excessive input %s',q=>expect(rankSearchMatch('Sữa đặc',['SKU-A','012345'],q)).toBeNull());
 it('rejects unrelated names',()=>expect(rankSearchMatch('Sữa đặc',['SKU-A'],'ban chai')).toBeNull());
});
