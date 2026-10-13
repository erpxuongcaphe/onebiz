import {describe,expect,it} from 'vitest';
import {financeMoneyCents,financeReportRangeError,isFinanceReportDate} from '@/lib/reports/finance-report-input';

describe('financial report input',() => {
  it('requires real calendar dates and ordered day boundaries',() => {
    expect(isFinanceReportDate('2024-02-29')).toBe(true);
    expect(isFinanceReportDate('2026-02-29')).toBe(false);
    expect(isFinanceReportDate('2026-10-13T01:00:00Z')).toBe(false);
    expect(financeReportRangeError('2026-10-13','2026-10-13')).toBe('');
    expect(financeReportRangeError('2026-10-20','2026-10-01')).not.toBe('');
    expect(financeReportRangeError('','')).not.toBe('');
  });
  it('preserves currency precision and rejects unsafe values',() => {
    expect(financeMoneyCents(11.99)).toBe(1199);
    expect(financeMoneyCents(0)).toBe(0);
    for (const amount of [NaN,Infinity,-1,0.001,Number.MAX_SAFE_INTEGER]) {
      expect(()=>financeMoneyCents(amount)).toThrow('không hợp lệ');
    }
  });
});
