/** Shared ranking contract. Identifiers are never corrected or fuzzy-matched. */
export type SearchMatchKind = 'identifier' | 'name' | 'partial' | 'near';
export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
/** At most one missing/extra/replaced letter, or one adjacent transposition. */
export function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length-b.length)>1 || a.length>64 || b.length>64) return false;
  if (a.length===b.length) {
    const positions: number[]=[];
    for(let i=0;i<a.length;i++) if(a[i]!==b[i]) positions.push(i);
    return positions.length===1 || (positions.length===2 && positions[1]===positions[0]+1
      && a[positions[0]]===b[positions[1]] && a[positions[1]]===b[positions[0]]);
  }
  const shorter=a.length<b.length?a:b, longer=a.length<b.length?b:a;
  let i=0; while(i<shorter.length && shorter[i]===longer[i]) i++;
  return shorter.slice(i)===longer.slice(i+1);
}
export function rankSearchMatch(name: string, identifiers: readonly string[], query: string): SearchMatchKind | null {
  const raw=query.trim().toLowerCase(), q=normalizeSearch(query);
  if(!q || q.length>160) return null;
  if(identifiers.some(id=>id.trim().toLowerCase()===raw)) return 'identifier';
  const n=normalizeSearch(name), words=q.split(' ');
  if(words.length>8) return null;
  if(n===q) return 'name';
  const haystack=normalizeSearch([name,...identifiers].join(' '));
  if(words.every(word=>haystack.includes(word))) return 'partial';
  // Digits and identifier-like queries must never suggest a different identifier.
  if(q.length<3 || /\d/.test(q)) return null;
  const candidates=n.split(' ');
  return words.every(word=>n.includes(word) || (word.length>=3 && candidates.some(c=>oneEditApart(word,c)))) ? 'near' : null;
}
