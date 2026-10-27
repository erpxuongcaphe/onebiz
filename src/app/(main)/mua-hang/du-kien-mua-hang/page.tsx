"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ChartCard } from "../../phan-tich/_components";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { formatCurrency, formatNumber, formatShortDate } from "@/lib/format";
// getCustomerGroups() (đồng bộ) luôn trả mảng RỖNG — phải dùng bản Async,
// nếu không ô chọn nhóm khách sẽ trống mãi mà không báo lỗi gì.
import {
  getPurchaseForecast,
  getCustomerGroupsAsync,
} from "@/lib/services";
import { getForecastCustomerOptions } from "@/lib/services/supabase/order-management-reads";
import type { PurchaseForecastResult } from "@/lib/services";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Icon } from "@/components/ui/icon";
import {
  filterPurchaseForecastRows,
  normalizePurchaseForecastQuery,
} from "@/lib/utils/purchase-forecast-filter";

type ItemView = "all" | "materials" | "sku";

export default function DuKienMuaHangPage() {
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", forceTable: true });
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { toast } = useToast();

  const [loaded, setLoaded] = useState<{key:string;value:PurchaseForecastResult} | null>(null);
  const [loading, setLoading] = useState(true);
  const [itemView, setItemView] = useState<ItemView>("all");
  const [itemQuery, setItemQuery] = useState("");

  // 29/07 (CEO): xem nhu cầu mua hàng theo TỪNG KHÁCH hoặc NHÓM KHÁCH —
  // trả lời câu "đơn của nhóm khách sỉ cần mua bao nhiêu nguyên liệu".
  const [customerId, setCustomerId] = useState<string>("");
  const [groupId, setGroupId] = useState<string>("");
  const [dsKhach, setDsKhach] = useState<{ id: string; name: string; code: string; phone: string | null }[]>([]);
  const [dsNhom, setDsNhom] = useState<{ id: string; name: string }[]>([]);

  const [optionsError,setOptionsError]=useState('');
  const [optionsLoading,setOptionsLoading]=useState(true);
  const [retry,setRetry]=useState(0);
  const [reportError,setReportError]=useState('');
  const [exporting,setExporting]=useState(false);
  const exportLock=useRef(false);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const queryKey=JSON.stringify([range.from,range.to,activeBranchId,customerId,groupId]);
  const data=loaded?.key===queryKey && isReady ? loaded.value : null;
  const exportKey=JSON.stringify([queryKey,itemView,itemQuery]);
  const currentExportKey=useRef(exportKey);currentExportKey.current=exportKey;
  useEffect(()=>{
    if(!isReady)return;
    let cancelled=false;setOptionsLoading(true);setOptionsError('');
    void Promise.allSettled([getForecastCustomerOptions(),getCustomerGroupsAsync()]).then(([customers,groups])=>{
      if(cancelled)return;
      if(customers.status==='fulfilled')setDsKhach(customers.value);else setDsKhach([]);
      if(groups.status==='fulfilled')setDsNhom(groups.value.map(g=>({id:g.value,name:g.label})));else setDsNhom([]);
      if(customers.status==='rejected'||groups.status==='rejected')setOptionsError('Chưa tải đủ khách hoặc nhóm khách. Bấm tải lại; không tự đổi bộ lọc.');
      setOptionsLoading(false);
    });
    return()=>{cancelled=true;};
  },[isReady,retry]);
  useEffect(()=>{
    if(!isReady)return;
    let cancelled=false;setLoading(true);setReportError('');
    getPurchaseForecast({dateFrom:range.from,dateTo:range.to,customerId:customerId||undefined,customerGroupId:groupId||undefined},activeBranchId)
      .then(value=>{if(!cancelled)setLoaded({key:queryKey,value});})
      .catch(err=>{if(!cancelled){setLoaded(null);setReportError(err instanceof Error?err.message:'Không tải được báo cáo.');}})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[range.from,range.to,activeBranchId,customerId,groupId,isReady,queryKey,retry]);
  const normalizedItemQuery = normalizePurchaseForecastQuery(itemQuery);

  const filteredMaterials = useMemo(
    () => filterPurchaseForecastRows(data?.materials ?? [], itemQuery),
    [data?.materials, itemQuery],
  );
  const filteredSkuRows = useMemo(
    () => filterPurchaseForecastRows(data?.skuRows ?? [], itemQuery),
    [data?.skuRows, itemQuery],
  );
  const filteredToBuyAmount = useMemo(
    () => filteredMaterials.reduce((sum, row) => sum + row.amount, 0),
    [filteredMaterials],
  );

  // Gộp SKU theo chi nhánh (tab 1)
  const skuByBranch = useMemo(() => {
    const groups = new Map<
      string,
      { branchName: string; rows: PurchaseForecastResult["skuRows"] }
    >();
    for (const r of filteredSkuRows) {
      const key = r.branchId ?? "null";
      const g = groups.get(key) ?? { branchName: r.branchName, rows: [] };
      g.rows.push(r);
      groups.set(key, g);
    }
    return [...groups.values()];
  }, [filteredSkuRows]);

  const handleExport = useCallback(async () => {
    if (!data || loading || exportLock.current) return;
    exportLock.current=true;setExporting(true); const key=exportKey;
    try {
    const title = buildReportTitleRows({
      title: "DỰ KIẾN MUA HÀNG",
      range,
      branchName: branchLabel,
      generatedAt: new Date(),
    });
    const customerLabel=dsKhach.find(c=>c.id===customerId);
    if(customerId && !customerLabel)throw new Error("Chưa tải được tên khách đang lọc. Tải lại danh sách trước khi xuất.");
    const filterTitle=`Khách: ${customerLabel?`${customerLabel.code} · ${customerLabel.name}`:"Tất cả"} · Nhóm: ${dsNhom.find(g=>g.id===groupId)?.name??"Tất cả"} · Loại: ${{all:"Tất cả NVL và SKU",materials:"NVL cần mua",sku:"SKU còn phải xuất"}[itemView]} · Tìm hàng: ${itemQuery.trim()||"Tất cả"}`;
    title.push(filterTitle);
    const sheets: ExcelSheet[] = [];
    if (itemView !== "sku") {
      sheets.push({
        name: "Dự kiến mua NVL",
        titleRows: [
          "DỰ KIẾN MUA NGUYÊN VẬT LIỆU",
          ...title.slice(1),
          `Tồn lấy tại: ${data.khoTongName ?? "Kho Tổng"} · Số đơn tính: ${data.orderCount}`,
        ],
        columns: [
          { label: "Mã NVL", key: "code", width: 16 },
          { label: "Tên", key: "name", width: 34 },
          { label: "ĐVT", key: "unit", width: 8 },
          { label: "SL cần", key: "req", width: 12, format: "number" },
          { label: "Tồn Kho Tổng", key: "stock", width: 14, format: "number" },
          { label: "Cần mua", key: "buy", width: 12, format: "number" },
          { label: "Đơn giá", key: "cost", width: 12, format: "currency" },
          { label: "Thành tiền", key: "amount", width: 16, format: "currency" },
        ],
        rows: filteredMaterials.map((m) => ({
          code: m.code,
          name: m.name,
          unit: m.unit,
          req: m.required,
          stock: m.stockKhoTong,
          buy: m.toBuy,
          cost: m.unitCost,
          amount: m.amount,
        })),
        footer: { code: "TỔNG", amount: filteredToBuyAmount },
      });
    }
    if (itemView !== "materials") {
      sheets.push({
        name: "Đặt hàng theo chi nhánh",
        titleRows: ["ĐẶT HÀNG THEO CHI NHÁNH (SKU)", ...title.slice(1)],
        columns: [
          { label: "Chi nhánh", key: "branch", width: 24 },
          { label: "Mã hàng", key: "code", width: 16 },
          { label: "Tên hàng", key: "name", width: 34 },
          { label: "ĐVT", key: "unit", width: 8 },
          { label: "SL đặt", key: "orderedQty", width: 12, format: "number" },
          { label: "Đã xuất", key: "issuedQty", width: 12, format: "number" },
          { label: "Còn cần", key: "remainingQty", width: 12, format: "number" },
          { label: "Giá trị còn lại", key: "amount", width: 16, format: "currency" },
        ],
        rows: filteredSkuRows.map((r) => ({
          branch: r.branchName,
          code: r.code,
          name: r.name,
          unit: r.unit,
          orderedQty: r.orderedQuantity,
          issuedQty: r.issuedQuantity,
          remainingQty: r.remainingQuantity,
          amount: r.amount,
        })),
      });
    }
    await exportReportToExcel({
      shouldSave:()=>mounted.current && currentExportKey.current===key,
      kind: "du-kien-mua-hang",
      mode: "full",
      description:filterTitle,
      range,
      branchName: branchLabel,
      sheets,
    });
    } catch(e) { if(mounted.current)toast({title:"Không xuất được file",description:e instanceof Error?e.message:"Vui lòng thử lại.",variant:"error"}); }
    finally {exportLock.current=false;if(mounted.current)setExporting(false);}
  }, [data, loading, exportKey, range, branchLabel, itemView, itemQuery, dsKhach, dsNhom, customerId, groupId, filteredMaterials, filteredSkuRows, filteredToBuyAmount, toast]);

  return (
    <div className="space-y-4">
      <ReportPageHeader
        title="Dự kiến mua hàng"
        subtitle="Chỉ lấy phần hàng còn phải xuất của đơn đặt hàng → nổ công thức → nguyên vật liệu cần chuẩn bị / mua"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportFull={handleExport}
        exportDisabled={loading || !data || exporting || optionsLoading}
      />

      <section aria-label="Bộ lọc dự kiến mua hàng" className="rounded-xl border bg-background p-4 lg:p-5">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-[180px_minmax(240px,1fr)_220px_minmax(280px,1.2fr)]">
          <div className="min-w-0">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Loại cần xem</label>
            <select aria-label="Loại cần xem" value={itemView}
              onChange={event=>setItemView(event.target.value as ItemView)}
              className="h-9 w-full rounded-lg border bg-background px-3 text-sm">
              <option value="all">Tất cả NVL và SKU</option>
              <option value="materials">NVL cần mua</option>
              <option value="sku">SKU còn phải xuất</option>
            </select>
          </div>
          <div className="min-w-0">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Mã hoặc tên NVL / SKU</label>
            <div className="relative">
              <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input aria-label="Mã hoặc tên NVL / SKU" value={itemQuery}
                onChange={event=>setItemQuery(event.target.value)} placeholder="Tìm mã hoặc tên hàng…"
                className="h-9 w-full rounded-lg border bg-background pl-9 pr-9 text-sm" />
              {itemQuery&&<button type="button" onClick={()=>setItemQuery("")} aria-label="Xóa nội dung tìm kiếm"
                className="absolute right-1.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                <Icon name="close" size={15}/>
              </button>}
            </div>
          </div>
          <div className="min-w-0">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nhóm khách</label>
            <SearchableSelect aria-label="Nhóm khách" disabled={optionsLoading} value={groupId}
              placeholder="Tất cả nhóm" preserveOrder
              options={[{value:"",label:"Tất cả nhóm"},...dsNhom.map(g=>({value:g.id,label:g.name}))]}
              onValueChange={value=>{setGroupId(value);if(value)setCustomerId("");}}/>
          </div>
          <div className="min-w-0">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Khách hàng cụ thể</label>
            <SearchableSelect aria-label="Khách hàng cụ thể" disabled={optionsLoading} value={customerId}
              placeholder="Tất cả khách" preserveOrder searchPlaceholder="Tìm mã, tên hoặc SĐT khách…"
              options={[{value:"",label:"Tất cả khách"},...dsKhach.map(c=>({value:c.id,label:c.name,meta:c.code,searchText:c.phone??""}))]}
              onValueChange={value=>{setCustomerId(value);if(value)setGroupId("");}}/>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Icon name="storefront" size={14}/>{branchLabel}</span>
          <span className="inline-flex items-center gap-1.5"><Icon name="event" size={14}/>{formatShortDate(range.from)} – {formatShortDate(range.to)}</span>
          {normalizedItemQuery&&<span className="text-primary">{filteredMaterials.length} NVL · {filteredSkuRows.length} SKU</span>}
          {(groupId||customerId)&&<>
            <span className="text-amber-700">Đang lọc theo khách hàng</span>
            <button type="button" onClick={()=>{setGroupId("");setCustomerId("");}}
              className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 hover:bg-muted hover:text-foreground">
              <Icon name="filter_alt_off" size={14}/>Bỏ lọc khách
            </button>
          </>}
        </div>
      </section>

      {optionsError && <p role="alert" className="text-sm text-destructive">{optionsError} <button type="button" className="underline" onClick={()=>setRetry(n=>n+1)}>Tải lại danh sách</button></p>}
      {reportError && <p role="alert" className="text-sm text-destructive">{reportError} <button type="button" className="underline" onClick={()=>setRetry(n=>n+1)}>Thử lại</button></p>}
      {exporting && <p role="status" className="text-sm text-muted-foreground">Đang chuẩn bị file theo bộ lọc…</p>}
      {/* Ghi chú nguồn số liệu */}
      <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-2.5 text-sm text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <Icon name="inventory_2" size={16} className="text-primary" />
          Tồn lấy tại: <strong className="text-foreground">{data?.khoTongName ?? "Kho Tổng"}</strong>
        </span>
        <span>· Đơn còn hàng chưa xuất: <strong className="text-foreground">{data?.orderCount ?? 0}</strong></span>
        <span>· Đơn giá = giá vốn</span>
      </div>

      {/* ① Dự kiến mua NVL */}
      {itemView !== "sku" && <ChartCard
        title="Dự kiến mua nguyên vật liệu"
        subtitle={`${filteredMaterials.length} loại NVL · Tổng cần mua: ${formatCurrency(filteredToBuyAmount)}`}
      >
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Đang tính...</div>
        ) : !data || filteredMaterials.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Không có hàng còn phải xuất trong các đơn phù hợp (hoặc SKU chưa có công thức).
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-3 font-medium">Mã NVL</th>
                  <th className="text-left py-2 pr-3 font-medium">Tên</th>
                  <th className="text-left py-2 pr-3 font-medium">ĐVT</th>
                  <th className="text-right py-2 pr-3 font-medium">SL cần</th>
                  <th className="text-right py-2 pr-3 font-medium">Tồn Kho Tổng</th>
                  <th className="text-right py-2 pr-3 font-medium">Cần mua</th>
                  <th className="text-right py-2 pr-3 font-medium">Đơn giá</th>
                  <th className="text-right py-2 font-medium">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {filteredMaterials.map((m) => (
                  <tr
                    key={m.materialId}
                    className={m.toBuy > 0 ? "border-b last:border-0 bg-status-warning/5" : "border-b last:border-0"}
                  >
                    <td className="py-2 pr-3 font-mono text-xs font-medium text-primary">{m.code}</td>
                    <td className="py-2 pr-3">{m.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{m.unit}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(m.required)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatNumber(m.stockKhoTong)}</td>
                    <td className={"py-2 pr-3 text-right tabular-nums font-semibold " + (m.toBuy > 0 ? "text-status-warning" : "text-status-success")}>
                      {formatNumber(m.toBuy)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatCurrency(m.unitCost)}</td>
                    <td className="py-2 text-right tabular-nums font-medium">{formatCurrency(m.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2">
                  <td className="py-2 pr-3" colSpan={7}>TỔNG TIỀN CẦN MUA</td>
                  <td className="py-2 text-right tabular-nums text-primary">{formatCurrency(filteredToBuyAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </ChartCard>}

      {/* ② Đặt hàng theo chi nhánh */}
      {itemView !== "materials" && <ChartCard title="Hàng còn phải xuất theo chi nhánh" subtitle="Đối chiếu số đặt, số đã xuất và số còn phải chuẩn bị cho dự kiến mua">
        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Đang tải...</div>
        ) : skuByBranch.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Chưa có đơn đặt hàng phù hợp</div>
        ) : (
          <div className="space-y-5">
            {skuByBranch.map((g) => (
              <div key={g.branchName}>
                <div className="text-sm font-semibold text-primary mb-1.5 flex items-center gap-1.5">
                  <Icon name="store" size={15} /> {g.branchName}
                  <span className="text-xs font-normal text-muted-foreground">({g.rows.length} mặt hàng)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-1.5 pr-3 font-medium">Mã hàng</th>
                        <th className="text-left py-1.5 pr-3 font-medium">Tên hàng</th>
                        <th className="text-left py-1.5 pr-3 font-medium">ĐVT</th>
                        <th className="text-right py-1.5 pr-3 font-medium">SL đặt</th>
                        <th className="text-right py-1.5 pr-3 font-medium">Đã xuất</th>
                        <th className="text-right py-1.5 pr-3 font-medium">Còn cần</th>
                        <th className="text-right py-1.5 font-medium">Giá trị còn lại</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.branchName + r.productId} className="border-b last:border-0">
                          <td className="py-1.5 pr-3 font-mono text-xs text-primary">{r.code}</td>
                          <td className="py-1.5 pr-3">{r.name}</td>
                          <td className="py-1.5 pr-3 text-muted-foreground">{r.unit}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(r.orderedQuantity)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{formatNumber(r.issuedQuantity)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-primary">{formatNumber(r.remainingQuantity)}</td>
                          <td className="py-1.5 text-right tabular-nums">{formatCurrency(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </ChartCard>}
    </div>
  );
}
