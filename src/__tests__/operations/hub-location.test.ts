import {beforeEach,describe,it,expect} from 'vitest';
import {readHubLocation,readHubFilters,writeHubLocation,writeHubFilters} from '@/lib/operations/hub-location';
import {workProgress} from '@/lib/operations/work-presentation';
const branch='11111111-1111-4111-8111-111111111111';
beforeEach(()=>window.history.replaceState(null,'','/hub'));
describe('Hub view context without business writes',()=>{
 it.each(['overview','work','todo','qc','kpi','settings'])('restores %s and its branch/month',view=>{
  expect(readHubLocation(`?view=${view}&branch=${branch}&period=2026-10`,'2026-11')).toEqual({view,branch,period:'2026-10',assessment:''});
 });
 it('rejects invalid views, branch identifiers and calendar months',()=>{
  expect(readHubLocation('?view=admin&branch=sql&period=2026-99&assessment=bad','2026-11')).toEqual({view:'work',branch:'',period:'2026-11',assessment:''});
 });
 it('keeps assessment period independent from the reference month',()=>{
  const result=readHubLocation('?view=qc&period=2026-10&assessment=2026-11','2026-11');
  expect(result.period).toBe('2026-10');expect(result.assessment).toBe('2026-11');
 });
 it('restores validated search, page and filters, not arbitrary permission keys',()=>{
  expect(readHubFilters(`?f_search=pha%20ch%E1%BA%BF&f_result=unknown&f_mine=true&f_assignee=${branch}&f_offset=50&f_preset=custom&f_from=2026-11-01&role=owner`)).toEqual({search:'pha chế',result:'unknown',mine:'true',assignee:branch,offset:'50',preset:'custom',from:'2026-11-01'});
 });
 it('rejects invalid dates, enum filters, page offsets and person IDs',()=>{
  expect(readHubFilters('?f_from=2026-02-31&f_to=oops&f_preset=secret&f_assignee=any&f_offset=3&f_result=approved')).toEqual({});
 });
 it('writes only context and preserves the rest of the current view',()=>{
  writeHubLocation({view:'qc',branch,period:'2026-11'},true);writeHubFilters({search:'cà phê',offset:50,result:'unknown'});
  expect(new URLSearchParams(location.search).get('view')).toBe('qc');expect(readHubFilters(location.search).search).toBe('cà phê');
  writeHubLocation({view:'todo'},true,true);
  expect(readHubFilters(location.search)).toEqual({});expect(new URLSearchParams(location.search).get('branch')).toBe(branch);
 });
});
describe('Separate task progress and inspection result',()=>{
 const run={original_due_at:'2026-11-01T16:59:00Z',quality:'unknown',checks:[] as {created_at:string}[]};
 it('does not turn overdue unknown into a failed inspection',()=>{
  expect(workProgress(run,Date.parse('2026-11-03T16:59:00Z'))).toEqual({label:'Quá hạn 2 ngày',tone:'overdue'});expect(run.quality).toBe('unknown');
 });
 it('does not mark a future unknown task overdue',()=>expect(workProgress(run,Date.parse('2026-11-01T12:00:00Z')).label).toBe('Chưa đến hạn'));
 it('keeps late completion against the original deadline after an extension',()=>{
  expect(workProgress({...run,current_due_at:'2026-11-04T16:59:00Z',quality:'met',checks:[{created_at:'2026-11-02T12:00:00Z'}]}).label).toBe('Hoàn thành trễ hạn gốc');
 });
 it('does not invent completion time when an inspection timestamp is absent',()=>expect(workProgress({...run,quality:'met'}).label).toContain('xem thời điểm'));
});
