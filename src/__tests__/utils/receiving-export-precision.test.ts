import {afterEach,describe,expect,it,vi} from 'vitest';
import {Blob as NodeBlob} from 'node:buffer';
import * as XLSX from 'xlsx';
vi.mock('file-saver',()=>({saveAs:vi.fn()}));
import {exportToExcel} from '@/lib/utils/export';
afterEach(()=>vi.unstubAllGlobals());
describe('receiving Excel precision',()=>{
  it('retains numeric four-decimal quantities and twelve-decimal conversions',async()=>{
    vi.stubGlobal('Blob',NodeBlob);
    let file:Blob|undefined;
    await exportToExcel([{quantity:0.0042,factor:1/3,legacy:1.239}],
      [{header:'Số lượng',key:'quantity',precision:4},{header:'Hệ số',key:'factor',precision:12},{header:'Tiền',key:'legacy'}],
      'receiving-fixture',{financialTable:true,onPrepared:blob=>{file=blob;}});
    const book=XLSX.read(new Uint8Array(await file!.arrayBuffer()),{type:'array',cellNF:true});
    const sheet=book.Sheets.Data;
    expect(sheet.A2.v).toBe(0.0042);expect(sheet.A2.t).toBe('n');expect(sheet.A2.z).toBe('#,##0.####');
    expect(sheet.B2.v).toBeCloseTo(0.333333333333,12);
    expect(sheet.C2.v).toBe(1.24);
  });
});
