import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Filter, Plus, RefreshCcw, Search } from 'lucide-react';
import { formatCurrency } from '../constants';
import { fetchBranches, fetchCurrentBranchId } from '../lib/branches';
import { setMyBranch } from '../lib/branches';
import { fetchInventoryWarehouses, type InventoryWarehouse } from '../lib/inventory';
import {
  addInventoryDocumentLine,
  createInventoryDocument,
  deleteInventoryDocumentLine,
  fetchInventoryDocumentLines,
  fetchInventoryDocuments,
  fetchProductsForPick,
  postInventoryDocument,
  updateInventoryDocumentLine,
  voidInventoryDocument,
  updateInventoryDocument,
  type InventoryDocument,
  type InventoryDocumentLine,
  type ProductPick,
} from '../lib/inventoryDocuments';
import { useAuth } from '../lib/auth';
import { withTimeout } from '../lib/async';
import { ensureDefaultTemplates, fetchDocumentTemplates, getActiveTemplate, type DocumentTemplate, type PaperSize, type TemplateType } from '../lib/documentTemplates';
import { renderDocumentHtml, openPrintWindow, downloadPdf, exportToExcel } from '../lib/documentPrint';
import { buildInventoryDocumentPayload } from '../lib/documentPayloads';
import { createDocumentPrint } from '../lib/documentPrintStore';
import Drawer from './Drawer';

type TimePreset = 'today' | 'month' | 'year' | 'range' | 'all';

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const InventoryDocuments: React.FC = () => {
  const { can, loading } = useAuth();

  const [q, setQ] = useState('');
  const [timePreset, setTimePreset] = useState<TimePreset>('month');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [branchId, setBranchId] = useState<string>('');
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [branches, setBranches] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [warehouses, setWarehouses] = useState<InventoryWarehouse[]>([]);

  const [docType, setDocType] = useState('');
  const [status, setStatus] = useState('');

  const [rows, setRows] = useState<InventoryDocument[] | null>(null);
  const [selected, setSelected] = useState<InventoryDocument | null>(null);
  const [lines, setLines] = useState<InventoryDocumentLine[]>([]);
  const [products, setProducts] = useState<ProductPick[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [templatePaperSize, setTemplatePaperSize] = useState<PaperSize>('A5');

  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<'receipt' | 'issue' | 'transfer'>('receipt');
  const [createDate, setCreateDate] = useState(todayISO());
  const [createWarehouseFrom, setCreateWarehouseFrom] = useState('');
  const [createWarehouseTo, setCreateWarehouseTo] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [loadingTooLong, setLoadingTooLong] = useState(false);

  useEffect(() => {
    if (timePreset === 'range') return;
    if (timePreset === 'all') {
      setFromDate('');
      setToDate('');
      return;
    }
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    if (timePreset === 'today') {
      const iso = `${yyyy}-${mm}-${dd}`;
      setFromDate(iso);
      setToDate(iso);
      return;
    }
    if (timePreset === 'month') {
      setFromDate(`${yyyy}-${mm}-01`);
      setToDate(`${yyyy}-${mm}-${dd}`);
      return;
    }
    if (timePreset === 'year') {
      setFromDate(`${yyyy}-01-01`);
      setToDate(`${yyyy}-${mm}-${dd}`);
    }
  }, [timePreset]);

  useEffect(() => {
    let isMounted = true;
    const loadTemplates = async () => {
      await ensureDefaultTemplates();
      const list = await fetchDocumentTemplates();
      if (isMounted) setTemplates(list);
    };
    void loadTemplates();
    return () => {
      isMounted = false;
    };
  }, []);

  const reload = async () => {
    setLoadingTooLong(false);
    setError(null);

    try {
      if (loading) {
        // Wait until auth settles.
        setRows(null);
        return;
      }
      if (!can('inventory.document.read')) {
        setRows([]);
        setLoadingTooLong(false);
        setError('Bạn không có quyền xem Phiếu kho.');
        return;
      }

      const [b, w, currentBranch] = await Promise.all([
        fetchBranches(),
        fetchInventoryWarehouses(),
        fetchCurrentBranchId(),
      ]);
      setBranches(b);
      setWarehouses(w);
      setCurrentBranchId(currentBranch ?? null);
      if (!branchId) {
        if (currentBranch) {
          setBranchId(currentBranch);
        } else if (can('branch.read_all') && b.length > 0) {
          setBranchId(b[0].id);
        }
      }

      const effectiveBranch = can('branch.read_all')
        ? (branchId || undefined)
        : ((currentBranch ?? branchId) || undefined);
      const docs = await fetchInventoryDocuments({
        branchId: effectiveBranch,
        docType: docType || undefined,
        status: status || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        warehouseId: warehouseId || undefined,
      });
      setRows(docs);

      const picks = await fetchProductsForPick();
      setProducts(picks);
    } catch {
      setRows([]);
      setLoadingTooLong(true);
      setError('Không tải được dữ liệu (mất kết nối hoặc Supabase đang lỗi).');
    }
  };

  useEffect(() => {
    if (loading) return;
    setRows(null);
    const timer = window.setTimeout(() => {
      setLoadingTooLong(true);
      setRows((prev) => (prev === null ? [] : prev));
      setError((prev) => prev ?? 'Đang tải quá lâu. Kiểm tra mạng hoặc thử bấm Làm mới.');
    }, 8000);

    void reload().finally(() => window.clearTimeout(timer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, docType, status, fromDate, toDate, warehouseId, loading]);

  const warehouseName = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? (id ?? '-');

  const canCreate = can('inventory.document.create');
  const createBranchId = branchId || currentBranchId || '';
  const createDisabledReason = !canCreate
    ? 'Bạn không có quyền tạo phiếu.'
    : !createBranchId
      ? 'Chưa xác định chi nhánh.'
      : '';

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = rows ?? [];
    if (!term) return list;
    return list.filter((d) => d.doc_number.toLowerCase().includes(term));
  }, [rows, q]);

  const loadSelected = async (doc: InventoryDocument) => {
    setSelected(doc);
    const l = await fetchInventoryDocumentLines(doc.id);
    setLines(l);
  };

  const typeLabel = (t: InventoryDocument['doc_type']) => {
    if (t === 'receipt') return 'Nhập kho';
    if (t === 'issue') return 'Xuất kho';
    return 'Chuyển kho';
  };

  const exportCsv = () => {
    const list = filtered;
    const header = ['doc_number', 'doc_type', 'status', 'doc_date', 'warehouse_from_id', 'warehouse_to_id', 'notes'];
    const rows = list.map((d) => [
      d.doc_number,
      d.doc_type,
      d.status,
      d.doc_date,
      d.warehouse_from_id ?? '',
      d.warehouse_to_id ?? '',
      (d.notes ?? '').replace(/\n/g, ' '),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory_documents_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printDocument = async (doc: InventoryDocument, docLines: InventoryDocumentLine[], mode: 'print' | 'pdf' | 'excel') => {
    const whName = (id: string | null) => warehouses.find((x) => x.id === id)?.name ?? (id ?? '-');
    const branchName = branches.find((b) => b.id === doc.branch_id)?.name ?? null;
    const productNameById: Record<string, string> = {};
    products.forEach((p) => {
      productNameById[p.id] = p.name;
    });

    const templateType: TemplateType =
      doc.doc_type === 'receipt'
        ? 'inventory_receipt'
        : doc.doc_type === 'issue'
          ? 'inventory_issue'
          : 'inventory_transfer';

    const template = getActiveTemplate(templates, templateType, templatePaperSize);
    if (!template) {
      setError('Chưa có mẫu chứng từ phù hợp. Vui lòng tạo trong Cài đặt.');
      return;
    }

    const company = {
      name: template.settings.company_name,
      tax_code: template.settings.company_tax_code,
      address: template.settings.company_address,
      phone: template.settings.company_phone,
      logo_url: template.settings.logo_url ?? null,
    };

    const payload = buildInventoryDocumentPayload({
      doc,
      lines: docLines,
      productNameById,
      warehouseFrom: whName(doc.warehouse_from_id),
      warehouseTo: whName(doc.warehouse_to_id),
      branchName,
      company,
    });

    const html = renderDocumentHtml(payload, {
      paperSize: template.paper_size,
      layout: template.layout,
      settings: template.settings,
    });

    if (mode === 'excel') {
      await exportToExcel(payload, `${doc.doc_number}.xlsx`);
      return;
    }

    if (mode === 'pdf') {
      await downloadPdf(html, `${doc.doc_number}.pdf`, template.paper_size);
      return;
    }

    openPrintWindow(html, doc.doc_number);
    await createDocumentPrint({
      template_id: template.id,
      template_type: template.template_type,
      paper_size: template.paper_size,
      source_type: 'manual',
      source_id: doc.id,
      payload,
    });
  };

  return (
    <div className="space-y-3 lg:space-y-5 animate-fade-in pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-lg lg:text-xl font-bold text-slate-900 dark:text-white">Phiếu kho</h2>
          <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">Nhập / Xuất / Chuyển kho theo chi nhánh.</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={() => void reload()}
            className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            Làm mới
          </button>
          <button
            disabled={!canCreate}
            onClick={() => {
              setError(null);
              setCreateType('receipt');
              setCreateDate(todayISO());
              setCreateWarehouseFrom('');
              setCreateWarehouseTo('');
              setCreateNotes('');
              setCreateOpen(true);
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white"
            title={createDisabledReason || 'Tạo phiếu kho'}
          >
            <Plus className="w-3.5 h-3.5" />
            Tạo phiếu
          </button>
        </div>
      </div>

      {createDisabledReason && (
        <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg px-3 py-2">
          Nút tạo phiếu đang bị khóa: {createDisabledReason}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-2 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-2 justify-between items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white transition-all placeholder:text-slate-400"
              placeholder="Tìm theo số phiếu..."
            />
          </div>

          <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
            <button className="whitespace-nowrap flex items-center justify-center gap-2 px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              <Filter className="w-3 h-3" />
              Lọc
            </button>

            <select
              value={timePreset}
              onChange={(e) => setTimePreset(e.target.value as TimePreset)}
              className="whitespace-nowrap px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900"
              title="Thời gian"
            >
              <option value="month">Tháng này</option>
              <option value="today">Hôm nay</option>
              <option value="year">Năm nay</option>
              <option value="range">Khoảng</option>
              <option value="all">Tất cả</option>
            </select>
            {timePreset === 'range' && (
              <>
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs" />
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs" />
              </>
            )}

            {(can('branch.read_all') || can('branch.switch')) && (
              <select
                value={branchId}
                onChange={async (e) => {
                  const id = e.target.value;
                  setBranchId(id);
                  if (id && can('branch.switch')) {
                    await setMyBranch(id);
                  }
                }}
                className="whitespace-nowrap px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900"
                title="Chi nhánh"
              >
                {can('branch.read_all') && <option value="">Tất cả chi nhánh</option>}
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}

            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="whitespace-nowrap px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900"
              title="Kho"
            >
              <option value="">Tất cả kho</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>

            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="whitespace-nowrap px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900"
              title="Loại"
            >
              <option value="">Tất cả loại</option>
              <option value="receipt">Nhập kho</option>
              <option value="issue">Xuất kho</option>
              <option value="transfer">Chuyển kho</option>
            </select>

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="whitespace-nowrap px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900"
              title="Trạng thái"
            >
              <option value="">Tất cả trạng thái</option>
              <option value="draft">Nháp</option>
              <option value="posted">Đã ghi sổ</option>
              <option value="void">Hủy</option>
            </select>

            <button
              onClick={exportCsv}
              className="whitespace-nowrap px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              title="Xuất CSV"
            >
              Xuất CSV
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700 text-[10px] lg:text-[11px]">
              <tr>
                <th className="px-2 py-2">Số phiếu</th>
                <th className="px-2 py-2">Loại</th>
                <th className="px-2 py-2">Ngày</th>
                <th className="px-2 py-2">Trạng thái</th>
                <th className="px-2 py-2">Kho</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows === null && (
                <tr>
                  <td colSpan={5} className="px-2 py-2 text-[11px] text-slate-500 dark:text-slate-400">Đang tải dữ liệu...</td>
                </tr>
              )}
              {rows !== null && loadingTooLong && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-2 text-[11px] text-amber-700 dark:text-amber-400">Tải dữ liệu chậm. Bấm “Làm mới” hoặc kiểm tra mạng.</td>
                </tr>
              )}
              {rows !== null && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-2 text-[11px] text-slate-500 dark:text-slate-400">Không có dữ liệu.</td>
                </tr>
              )}
              {filtered.map((d) => (
                <tr
                  key={d.id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                  onClick={() => void loadSelected(d)}
                >
                  <td className="px-2 py-2 font-mono text-indigo-600 dark:text-indigo-400 text-[11px]">{d.doc_number}</td>
                  <td className="px-2 py-2 text-slate-900 dark:text-slate-200 font-semibold">{typeLabel(d.doc_type)}</td>
                  <td className="px-2 py-2 text-slate-600 dark:text-slate-400 tabular-nums text-[11px]">{d.doc_date}</td>
                  <td className="px-2 py-2">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold ring-1 ring-inset ${d.status === 'posted' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 ring-emerald-600/20' : d.status === 'void' ? 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 ring-rose-600/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-300/40 dark:ring-slate-700/60'}`}>
                      {d.status === 'posted' ? 'Đã ghi sổ' : d.status === 'void' ? 'Hủy' : 'Nháp'}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-slate-600 dark:text-slate-400 text-[11px]">
                    {d.doc_type === 'transfer'
                      ? `${warehouseName(d.warehouse_from_id)} → ${warehouseName(d.warehouse_to_id)}`
                      : d.doc_type === 'receipt'
                        ? `${warehouseName(d.warehouse_to_id)}`
                        : `${warehouseName(d.warehouse_from_id)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        isOpen={!!selected}
        onClose={() => {
          if (busy) return;
          setSelected(null);
        }}
        title="Chi tiết phiếu"
      >
        {selected && (
          <div className="space-y-3">
            {error && (
              <div className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2.5">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(selected.doc_type === 'issue' || selected.doc_type === 'transfer') && (
                <label className="block">
                  <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Kho xuất</div>
                  <select
                    value={selected.warehouse_from_id ?? ''}
                    onChange={(e) => setSelected({ ...selected, warehouse_from_id: e.target.value || null })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                  >
                    <option value="">Chọn kho</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {(selected.doc_type === 'receipt' || selected.doc_type === 'transfer') && (
                <label className="block">
                  <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Kho nhập</div>
                  <select
                    value={selected.warehouse_to_id ?? ''}
                    onChange={(e) => setSelected({ ...selected, warehouse_to_id: e.target.value || null })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                  >
                    <option value="">Chọn kho</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Khổ giấy</div>
                <select
                  value={templatePaperSize}
                  onChange={(e) => setTemplatePaperSize(e.target.value as PaperSize)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                >
                  <option value="A5">A5</option>
                  <option value="A4">A4</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button
                disabled={busy}
                onClick={() => void printDocument(selected, lines, 'print')}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 py-2 rounded-lg text-xs font-bold"
              >
                In phiếu
              </button>
              <button
                disabled={busy}
                onClick={() => void printDocument(selected, lines, 'pdf')}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 py-2 rounded-lg text-xs font-bold"
              >
                Xuất PDF
              </button>
              <button
                disabled={busy}
                onClick={() => void printDocument(selected, lines, 'excel')}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 py-2 rounded-lg text-xs font-bold"
              >
                Xuất Excel
              </button>
              <button
                disabled={busy || !can('inventory.document.void')}
                onClick={async () => {
                  setError(null);
                  const ok = window.confirm('Hủy phiếu sẽ chuyển trạng thái sang Hủy. Nếu phiếu đã ghi sổ, hệ thống sẽ tự đảo tồn.');
                  if (!ok) return;
                  setBusy(true);
                  try {
                    const okVoid = await voidInventoryDocument(selected.id, voidReason || undefined);
                    if (!okVoid) {
                      setError('Không hủy được (kiểm tra quyền).');
                      return;
                    }
                    setSelected(null);
                    await reload();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="sm:col-span-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100/60 dark:hover:bg-rose-900/30 py-2 rounded-lg text-xs font-bold"
              >
                Hủy phiếu
              </button>
            </div>

            <label className="block">
              <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Lý do hủy (tùy chọn)</div>
              <input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                placeholder="..."
              />
            </label>

            <label className="block">
              <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Ghi chú</div>
              <input
                value={selected.notes ?? ''}
                onChange={(e) => setSelected({ ...selected, notes: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                placeholder="..."
              />
            </label>

            {selected.status === 'draft' && (
              <button
                disabled={busy || !can('inventory.document.update')}
                onClick={async () => {
                  setError(null);
                  setBusy(true);
                  try {
                    const ok = await updateInventoryDocument(selected.id, {
                      warehouse_from_id: selected.warehouse_from_id,
                      warehouse_to_id: selected.warehouse_to_id,
                      notes: selected.notes ?? null,
                    });
                    if (!ok) {
                      setError('Không lưu được (kiểm tra quyền).');
                      return;
                    }
                    await reload();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 py-2 rounded-lg text-xs font-bold"
              >
                Lưu thông tin phiếu
              </button>
            )}

            <div className="bg-white/0 rounded-lg border border-slate-200 dark:border-slate-800 p-2">
              <div className="text-[11px] font-bold text-slate-900 dark:text-white mb-2">Dòng hàng</div>

              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                  defaultValue=""
                  id="inv-doc-product"
                >
                  <option value="">Chọn sản phẩm</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} - {p.name}
                    </option>
                  ))}
                </select>
                <input
                  id="inv-doc-qty"
                  className="w-full sm:w-28 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                  placeholder="SL"
                  inputMode="numeric"
                />
                <input
                  id="inv-doc-cost"
                  className="w-full sm:w-32 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                  placeholder="Giá"
                  inputMode="numeric"
                />
                <button
                  disabled={busy || selected.status !== 'draft' || !can('inventory.document.update')}
                  onClick={async () => {
                    setError(null);
                    const prodEl = document.getElementById('inv-doc-product') as HTMLSelectElement | null;
                    const qtyEl = document.getElementById('inv-doc-qty') as HTMLInputElement | null;
                    const costEl = document.getElementById('inv-doc-cost') as HTMLInputElement | null;
                    const productId = prodEl?.value || '';
                    const qty = Number.parseFloat(qtyEl?.value || '0');
                    const cost = Number.parseFloat(costEl?.value || '0');
                    if (!productId) {
                      setError('Chọn sản phẩm.');
                      return;
                    }
                    if (!Number.isFinite(qty) || qty <= 0) {
                      setError('Số lượng phải > 0.');
                      return;
                    }
                    setBusy(true);
                    try {
                      const ok = await addInventoryDocumentLine({
                        document_id: selected.id,
                        product_id: productId,
                        quantity: qty,
                        unit_cost: Number.isFinite(cost) && cost > 0 ? cost : null,
                      });
                      if (!ok) {
                        setError('Không thêm được dòng (kiểm tra quyền).');
                        return;
                      }
                      const l = await fetchInventoryDocumentLines(selected.id);
                      setLines(l);
                      if (qtyEl) qtyEl.value = '';
                      if (costEl) costEl.value = '';
                      if (prodEl) prodEl.value = '';
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold"
                >
                  Thêm
                </button>
              </div>

              <div className="mt-2 space-y-1">
                {lines.length === 0 && <div className="text-[11px] text-slate-500 dark:text-slate-400">Chưa có dòng hàng.</div>}
                {lines.map((l) => {
                  const p = products.find((x) => x.id === l.product_id);
                  return (
                    <div key={l.id} className="text-[11px] py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-slate-200 truncate">
                            {p ? `${p.sku} - ${p.name}` : l.product_id}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">SL: {l.quantity}{l.unit_cost ? ` • Giá: ${formatCurrency(l.unit_cost)}` : ''}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            defaultValue={String(l.quantity)}
                            className="w-20 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                            inputMode="numeric"
                            disabled={selected.status !== 'draft' || !can('inventory.document.update')}
                            id={`line-qty-${l.id}`}
                          />
                          <input
                            defaultValue={l.unit_cost ? String(l.unit_cost) : ''}
                            className="w-24 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                            inputMode="numeric"
                            disabled={selected.status !== 'draft' || !can('inventory.document.update')}
                            id={`line-cost-${l.id}`}
                          />
                          <button
                            disabled={busy || selected.status !== 'draft' || !can('inventory.document.update')}
                            onClick={async () => {
                              setError(null);
                              const qtyEl = document.getElementById(`line-qty-${l.id}`) as HTMLInputElement | null;
                              const costEl = document.getElementById(`line-cost-${l.id}`) as HTMLInputElement | null;
                              const qty = Number.parseFloat(qtyEl?.value || '0');
                              const cost = Number.parseFloat(costEl?.value || '0');
                              if (!Number.isFinite(qty) || qty <= 0) {
                                setError('Số lượng phải > 0.');
                                return;
                              }
                              setBusy(true);
                              try {
                                const ok = await updateInventoryDocumentLine(l.id, {
                                  quantity: qty,
                                  unit_cost: Number.isFinite(cost) && cost > 0 ? cost : null,
                                });
                                if (!ok) {
                                  setError('Không cập nhật được dòng.');
                                  return;
                                }
                                const next = await fetchInventoryDocumentLines(selected.id);
                                setLines(next);
                              } finally {
                                setBusy(false);
                              }
                            }}
                            className="px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold disabled:opacity-60"
                          >
                            Lưu
                          </button>
                          <button
                            disabled={busy || selected.status !== 'draft' || !can('inventory.document.update')}
                            onClick={async () => {
                              const ok = window.confirm('Xóa dòng hàng này?');
                              if (!ok) return;
                              setError(null);
                              setBusy(true);
                              try {
                                const okDel = await deleteInventoryDocumentLine(l.id);
                                if (!okDel) {
                                  setError('Không xóa được dòng.');
                                  return;
                                }
                                const next = await fetchInventoryDocumentLines(selected.id);
                                setLines(next);
                              } finally {
                                setBusy(false);
                              }
                            }}
                            className="px-2 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100/60 dark:hover:bg-rose-900/30 text-xs font-bold disabled:opacity-60"
                          >
                            Xóa
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              disabled={busy || selected.status !== 'draft' || !can('inventory.document.post')}
              onClick={async () => {
                setError(null);
                if (lines.length === 0) {
                  setError('Phiếu chưa có dòng hàng.');
                  return;
                }
                if (selected.doc_type === 'receipt' && !selected.warehouse_to_id) {
                  setError('Chọn kho nhập.');
                  return;
                }
                if (selected.doc_type === 'issue' && !selected.warehouse_from_id) {
                  setError('Chọn kho xuất.');
                  return;
                }
                if (selected.doc_type === 'transfer' && (!selected.warehouse_from_id || !selected.warehouse_to_id)) {
                  setError('Chọn kho xuất và kho nhập.');
                  return;
                }
                setBusy(true);
                try {
                  const ok = await postInventoryDocument(selected.id);
                  if (!ok) {
                    setError('Không ghi sổ được (kiểm tra quyền/tồn kho).');
                    return;
                  }
                  setSelected(null);
                  await reload();
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-2 rounded-lg text-xs font-bold"
            >
              Ghi sổ (cập nhật tồn)
            </button>
          </div>
        )}
      </Drawer>

      <Drawer
        isOpen={createOpen}
        onClose={() => {
          if (busy) return;
          setCreateOpen(false);
        }}
        title="Tạo phiếu kho"
      >
        {error && (
          <div className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2.5 mb-3">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Loại phiếu</div>
              <select
                value={createType}
                onChange={(e) => setCreateType(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
              >
                <option value="receipt">Nhập kho</option>
                <option value="issue">Xuất kho</option>
                <option value="transfer">Chuyển kho</option>
              </select>
            </label>
            <label className="block">
              <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Ngày</div>
              <input
                type="date"
                value={createDate}
                onChange={(e) => setCreateDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(createType === 'issue' || createType === 'transfer') && (
              <label className="block">
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Kho xuất</div>
                <select
                  value={createWarehouseFrom}
                  onChange={(e) => setCreateWarehouseFrom(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                >
                  <option value="">Chọn kho</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {(createType === 'receipt' || createType === 'transfer') && (
              <label className="block">
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Kho nhập</div>
                <select
                  value={createWarehouseTo}
                  onChange={(e) => setCreateWarehouseTo(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                >
                  <option value="">Chọn kho</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label className="block">
            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Ghi chú</div>
            <input
              value={createNotes}
              onChange={(e) => setCreateNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
              placeholder="VD: nhập hàng, điều chuyển..."
            />
          </label>

          <button
            disabled={busy || !createBranchId || !canCreate}
            onClick={async () => {
              setError(null);
              if (!createBranchId) {
                setError('Chưa xác định chi nhánh.');
                return;
              }
              if (!createDate) {
                setError('Chọn ngày phiếu.');
                return;
              }
              if (createType === 'receipt' && !createWarehouseTo) {
                setError('Chọn kho nhập.');
                return;
              }
              if (createType === 'issue' && !createWarehouseFrom) {
                setError('Chọn kho xuất.');
                return;
              }
              if (createType === 'transfer' && (!createWarehouseFrom || !createWarehouseTo)) {
                setError('Chọn kho xuất và kho nhập.');
                return;
              }
              setBusy(true);
              try {
                const docNo = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
                const id = await withTimeout(
                  createInventoryDocument({
                    branch_id: createBranchId,
                    doc_type: createType,
                    doc_number: docNo,
                    doc_date: createDate,
                    warehouse_from_id: createWarehouseFrom || null,
                    warehouse_to_id: createWarehouseTo || null,
                    notes: createNotes || null,
                  }),
                  8000,
                  'Tạo phiếu quá lâu. Vui lòng kiểm tra mạng và thử lại.'
                );
                if (!id) {
                  setError('Không tạo được phiếu (kiểm tra quyền).');
                  return;
                }
                setCreateOpen(false);
                await reload();
                const created = await fetchInventoryDocuments({
                  branchId: createBranchId,
                  fromDate: createDate,
                  toDate: createDate,
                });
                const createdDoc = created.find((d) => d.id === id);
                if (createdDoc) {
                  await loadSelected(createdDoc);
                }
              } catch (e: any) {
                setError(e?.message ?? 'Không tạo được phiếu (kiểm tra quyền).');
              } finally {
                setBusy(false);
              }
            }}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
          >
            <Calendar className="w-4 h-4" />
            Tạo phiếu (nháp)
          </button>

        </div>
      </Drawer>
    </div>
  );
};

export default InventoryDocuments;
