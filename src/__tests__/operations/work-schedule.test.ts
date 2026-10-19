import { describe, expect, it } from 'vitest';
import { ceoWorkingRows } from '@/lib/operations/workbook-import';
import { missingWorkSchedules, workScheduleSummary } from '@/lib/operations/work-schedule';
describe('per-work recurrence without branch fallback',()=>{
 it('identifies only the two unspecified weekly source works without inventing weekdays',()=>{
  const before=JSON.stringify(ceoWorkingRows);
  expect(missingWorkSchedules(ceoWorkingRows).map(r=>r.number)).toEqual([32,33]);
  expect(JSON.stringify(ceoWorkingRows)).toBe(before);
 });
 it('preserves different weekdays and the daily schedule in the same library',()=>{
  const rows=[ceoWorkingRows[0],{...ceoWorkingRows[31],dayNumber:1},{...ceoWorkingRows[32],dayNumber:5}];
  expect(missingWorkSchedules(rows)).toEqual([]);
  expect(rows.map(workScheduleSummary)).toEqual(['Hằng ngày','Mỗi thứ Hai','Mỗi thứ Sáu']);
 });
 it('does not present Monday as a saved schedule when a day is missing',()=>{
  expect(workScheduleSummary(ceoWorkingRows[31])).toContain('Chưa chọn');
  expect(missingWorkSchedules([{...ceoWorkingRows[31],dayNumber:8}])).toHaveLength(1);
 });
 it('supports independent monthly quarterly yearly and one-off schedules',()=>{
  for(const row of [
   {...ceoWorkingRows[0],frequency:'once' as const},
   {...ceoWorkingRows[0],frequency:'monthly' as const,dayNumber:15},
   {...ceoWorkingRows[0],frequency:'quarterly' as const,dayNumber:15,monthNumber:2},
   {...ceoWorkingRows[0],frequency:'yearly' as const,dayNumber:15,monthNumber:12},
  ]) expect(missingWorkSchedules([row])).toEqual([]);
 });
});
