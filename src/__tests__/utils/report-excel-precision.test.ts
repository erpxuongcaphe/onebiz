import { describe, expect, it, vi } from 'vitest';

const { write, saveAs } = vi.hoisted(() => ({
  write: vi.fn((_workbook: unknown, _options: unknown) => new Uint8Array()),
  saveAs: vi.fn(),
}));

vi.mock('xlsx-js-style', async (importOriginal) => {
  const imported = await importOriginal<typeof import('xlsx-js-style')>();
  const actual = 'utils' in imported ? imported : (imported as { default: typeof imported }).default;
  const mocked = { ...actual, utils: actual.utils, write };
  return { ...mocked, default: mocked };
});
vi.mock('file-saver', () => ({ saveAs }));

import { exportReportToExcel } from '@/lib/utils/excel-export';

describe('Report workbook numeric precision', () => {
  it('filters only header and data, not title or total rows', async () => {
    write.mockClear();
    saveAs.mockClear();
    await exportReportToExcel({ kind: 'xuat-nhap-ton', mode: 'view', range: { from: '2026-10-01', to: '2026-10-06' }, sheets: [{
      name: 'Filtered', titleRows: ['Inventory'], autoFilter: true,
      columnGroups: [{ label: 'Stock', span: 2 }],
      columns: [{ label: 'Code', key: 'code' }, { label: 'Amount', key: 'amount', format: 'currency' }],
      rows: [{ code: 'NVL-001', amount: 100 }, { code: 'SKU-001', amount: null }], footer: { amount: 100 },
    }] });
    const workbook = write.mock.calls[0][0] as { Sheets: Record<string, Record<string, unknown>> };
    expect(workbook.Sheets.Filtered['!autofilter']).toEqual({ ref: 'A4:B6' });
  });
  it('retains fractional quantities and their total without rounding each line', async () => {
    write.mockClear();
    saveAs.mockClear();
    await exportReportToExcel({
      kind: 'xuat-nhap-ton', mode: 'view',
      range: { from: '2026-10-01', to: '2026-10-06' },
      sheets: [{
        name: 'Quantities',
        columns: [
          { label: 'Code', key: 'code' },
          { label: 'Quantity', key: 'qty', format: 'number', decimalPlaces: 4 },
          { label: 'Cost', key: 'cost', format: 'currency' },
        ],
        rows: [{ qty: 0.005, cost: 13.333 }, { qty: -0.004, cost: null }],
        footerLabel: 'Total', footer: { qty: 0.001 },
      }],
    });
    const workbook = write.mock.calls[0][0] as unknown as {
      Sheets: Record<string, Record<string, { v: unknown; z?: string }>>;
    };
    const sheet = workbook.Sheets.Quantities;
    expect(sheet.B2.v).toBe(0.005);
    expect(sheet.B2.z).toBe('#,##0.####');
    expect(sheet.B3.v).toBe(-0.004);
    expect(sheet.B4.v).toBe(0.001);
    expect(sheet.C2.v).toBe(13.33);
    expect(sheet.C3.v).toBe('');
    expect(saveAs).toHaveBeenCalledOnce();
  });
});
