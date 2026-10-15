"use client";
import { useRef, useState, type FormEvent } from 'react';
import type { QualityAction, QualityWorkspace } from '@/lib/operations/quality-contracts';
import { ONEBIZ_REVENUE_DEFINITION } from '@/lib/operations/revenue-import';
import { parseMoneyUS } from '@/lib/operations/policy';
import { formatNumber } from '@/lib/format';
import { Field, Notes, TextField } from './quality-fields';
import { Icon } from '@/components/ui/icon';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { Branch } from '@/lib/operations/contracts';
import { RevenueExcel } from './revenue-excel';
import s from './quality.module.css';

export function QualityBusinessSetup({ data, period, busy, onSave, commandError, branch }: {
  data: QualityWorkspace; period: string; busy: boolean;
  onSave: (action: QualityAction, payload: Record<string, unknown>) => Promise<boolean>;
  commandError?: string;
  branch?: Branch;
}) {
  const [source, setSource] = useState(data.target?.definition.label === ONEBIZ_REVENUE_DEFINITION ? 'onebiz' : 'external');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<'target'|'revenue'|null>(null);
  const [approval, setApproval] = useState<string|null>(null);
  const lock = useRef(false);
  const revenueRequest = useRef<{body:string;key:string}|null>(null);
  async function submit(event: FormEvent<HTMLFormElement>, action: 'target'|'revenue') {
    event.preventDefault();
    if (busy || lock.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const amount = parseMoneyUS(String(values.get('amount') ?? ''));
    if (amount === null || amount < 0 || action === 'target' && amount === 0) { setError('Nhập số tiền hợp lệ theo dạng 1,234.56; chỉ tiêu phải lớn hơn 0.'); return; }
    lock.current = true; setError('');
    try {
      const definition = action === 'target' ? source === 'onebiz' ? ONEBIZ_REVENUE_DEFINITION : String(values.get('definition') ?? '').trim() : data.target?.definition.label;
      if (!definition) { setError('Cần định nghĩa doanh thu trước khi ghi nguồn.'); return; }
      const revenueFields = {source:'manual',sourceName:values.get('sourceName'),evidence:values.get('evidence'),note:values.get('note')};
      if (action === 'revenue') {
        const body = JSON.stringify({period,amount,definition,...revenueFields});
        if (revenueRequest.current?.body !== body) revenueRequest.current = {body,key:crypto.randomUUID()};
      }
      const result = await onSave(action, { period, amountCents: amount, definition: {label:definition}, reason: values.get('reason'),
        ...(action === 'revenue' ? {...revenueFields,sourceKey:revenueRequest.current!.key} : {}),
      });
      if (result) { revenueRequest.current=null;setEditor(null); }
    } finally { lock.current = false; }
  }
  return <section className={s.section}>
    <h3>Nguồn doanh thu và chỉ tiêu kinh doanh</h3>
    {error && <p role="alert" className={s.alert}>{error}</p>}
    {data.can.manage && !data.settlement && <div className={s.actions}>
      <button disabled={busy} onClick={() => setEditor('target')}>Thiết lập chỉ tiêu</button>
      {data.target?.definition.label === ONEBIZ_REVENUE_DEFINITION ? <button disabled={busy} onClick={() => void onSave('onebiz_revenue',{period})}><Icon name="refresh" size={16}/>Lấy báo cáo theo kỳ</button> : <button disabled={busy || !data.target} onClick={() => setEditor('revenue')}>Nhập doanh thu ngoài OneBiz</button>}
    </div>}
    {branch && data.can.manage && !data.settlement && data.target && data.target.definition.label !== ONEBIZ_REVENUE_DEFINITION && <RevenueExcel branch={branch} period={period} definition={data.target.definition.label} busy={busy} assessmentPeriod={{key:period,label:data.periods?.find(item=>item.key===period)?.title ?? `${period.slice(5)}/${period.slice(0,4)}`}} onSave={(action,payload)=>action==='revenue_batch'?onSave('revenue_batch',payload):Promise.resolve(false)}/>}
    <Dialog open={editor !== null} onOpenChange={(open) => { if (!open && !busy) setEditor(null); }}>
      <DialogContent className={s.dialog} showCloseButton={false}>
      <div className={s.dialogHeader}><DialogTitle>{editor === 'target' ? 'Chỉ tiêu kinh doanh' : 'Doanh thu ngoài OneBiz'}</DialogTitle></div>
      {(error || commandError) && <p role="alert" className={s.alert}>{error || commandError}</p>}
      {editor === 'target' && <form className={s.dialogForm} onSubmit={(event) => void submit(event,'target')}>
        <div className={s.dialogBody}>
        <h4>Chỉ tiêu của kỳ</h4>
        <TextField label="Chỉ tiêu doanh thu (đồng)" name="amount" value={data.target ? formatNumber(data.target.amount_cents/100) : ''} required />
        <Field label="Nguồn doanh thu">{(id) => <select id={id} value={source} onChange={(event) => setSource(event.target.value)}><option value="external">Nguồn ngoài OneBiz</option><option value="onebiz">Báo cáo OneBiz FnB</option></select>}</Field>
        {source === 'external' ? <TextField label="Định nghĩa doanh thu" name="definition" value={data.target?.definition.label} required /> : <p>{ONEBIZ_REVENUE_DEFINITION}</p>}
        <Notes label="Lý do thiết lập hoặc thay đổi" name="reason" required />
        </div><div className={s.dialogFooter}>
        <button type="submit" disabled={busy} className={s.primary}><Icon name="save" size={16}/>Lưu chỉ tiêu</button>
        <button type="button" disabled={busy} onClick={() => setEditor(null)}>Đóng</button>
        </div></form>}
        {editor === 'revenue' && <form className={s.dialogForm} onSubmit={(event) => void submit(event,'revenue')}>
          <div className={s.dialogBody}>
          <h4>Số liệu ngoài OneBiz</h4><TextField label="Doanh thu (đồng)" name="amount" required /><TextField label="Tên nguồn báo cáo" name="sourceName" required /><Notes label="Chứng từ đối chiếu" name="evidence" required /><Notes />
          </div><div className={s.dialogFooter}>
          <button type="submit" disabled={busy || !data.target} className={s.primary}><Icon name="save" size={16}/>Gửi số liệu để duyệt</button>
          <button type="button" disabled={busy} onClick={() => setEditor(null)}>Đóng</button>
        </div></form>}
      </DialogContent>
    </Dialog>
    <Dialog open={approval !== null} onOpenChange={(open) => { if (!open && !busy) setApproval(null); }}>
      <DialogContent className={s.dialog} showCloseButton={false}>
        <div className={s.dialogHeader}><DialogTitle>Xác nhận nguồn doanh thu</DialogTitle></div>
        <form className={s.dialogForm} onSubmit={async (event) => {
          event.preventDefault();
          if (busy || lock.current || !approval) return;
          const values = new FormData(event.currentTarget);
          lock.current=true;
          try {if (await onSave('approve_revenue',{id:approval,period,reason:String(values.get('reason') ?? '').trim()})) setApproval(null);}
          finally {lock.current=false;}
        }}>
          <div className={s.dialogBody}>{commandError && <p role="alert" className={s.alert}>{commandError}</p>}<Notes label="Lý do xác nhận hoặc thay thế nguồn doanh thu" name="reason" required/></div>
          <div className={s.dialogFooter}><button type="button" disabled={busy} onClick={() => setApproval(null)}>Đóng</button><button type="submit" disabled={busy} className={s.primary}>Xác nhận</button></div>
        </form>
      </DialogContent>
    </Dialog>
    <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Nguồn</th><th>Định nghĩa</th><th className={s.numeric}>Doanh thu</th><th>Căn cứ</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{data.revenues?.map((revenue) => <tr key={revenue.id}><td>{revenue.source_name}</td><td>{revenue.definition.label}</td><td className={s.numeric}>{formatNumber(revenue.amount_cents/100)}</td><td>{revenue.evidence}</td><td>{revenue.state === 'approved' ? 'Đã duyệt' : revenue.state === 'superseded' ? 'Đã thay thế' : 'Chờ duyệt'}</td><td>{revenue.state === 'pending' && data.can.manage && !data.settlement && <button disabled={busy} onClick={() => setApproval(revenue.id)}>Duyệt nguồn</button>}</td></tr>)}</tbody></table></div>
  </section>;
}
