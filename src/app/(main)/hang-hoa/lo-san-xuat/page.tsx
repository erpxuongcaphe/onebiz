"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { FilterPanel, FilterGroup, SelectFilter, CheckboxFilter, DatePresetFilter, type DatePresetValue } from "@/components/shared/filter-sidebar";
import { FilterChips, type ListFilterChip } from "@/components/shared/filter-chips";
import { ListMetric } from "@/components/shared/list-metric";
import { AllBranchesBanner } from "@/components/shared/all-branches-banner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { usePermissions, useTxRowPermissions } from "@/lib/permissions";
import { useDebounce } from "@/lib/utils/use-debounce";
import { computeListPresetRange, STANDARD_LIST_PRESETS_WITH_ALL } from "@/lib/utils/list-date-preset-range";
import { getProductLotListWorkspace, getProductLotsForExport } from "@/lib/services";
import { exportToExcel } from "@/lib/utils/export";
import { formatDate, formatNumber } from "@/lib/format";
import type { ProductLot } from "@/lib/types";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";

const AssignExpiryDialog = dynamic(
  () => import("@/components/shared/dialogs/assign-expiry-existing-stock-dialog").then((m) => m.AssignExpiryDialog),
  { ssr: false },
);

type LotRow = ProductLot & { productName: string; productCode: string; daysUntilExpiry?: number };
const statusOptions = [
  { label: "Đang hoạt động", value: "active" }, { label: "Đã hết", value: "consumed" },
  { label: "Hết hạn", value: "expired" }, { label: "Đã hủy", value: "cancelled" },
  { label: "Đã xử lý", value: "disposed" },
];
const sourceOptions = [
  { label: "Sản xuất", value: "production" }, { label: "Mua hàng", value: "purchase" },
  { label: "Tồn đầu kỳ", value: "opening" }, { label: "Điều chỉnh", value: "adjustment" },
  { label: "Chuyển kho", value: "transfer" },
];
const expiryOptions = [
  { value: "all", label: "Tất cả" }, { value: "expired", label: "Đã hết hạn" },
  { value: "upcoming", label: "Sắp hết hạn trong 30 ngày" }, { value: "no_expiry", label: "Chưa có hạn sử dụng" },
];
const searchFields = [
  { value: "all", label: "Tất cả" }, { value: "lot_number", label: "Số lô" },
  { value: "product_code", label: "Mã hàng" }, { value: "product_name", label: "Tên hàng" },
];
const statusMap: Record<string,{label:string;tone:"success"|"neutral"|"error"}> = {
  active:{label:"Đang dùng",tone:"success"}, consumed:{label:"Đã hết",tone:"neutral"},
  disposed:{label:"Đã xử lý",tone:"neutral"}, expired:{label:"Hết hạn",tone:"error"},
  cancelled:{label:"Đã hủy",tone:"neutral"},
};
const toneClass = { success:"bg-status-success/10 text-status-success", neutral:"bg-surface-container-high text-muted-foreground", error:"bg-status-error/10 text-status-error" };
const dotClass = { success:"bg-status-success", neutral:"bg-muted-foreground", error:"bg-status-error" };

function nextDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export default function LoSanXuatPage() {
  const { toast } = useToast();
  const { activeBranchId, currentBranch, isReady } = useBranchFilter();
  const { hasAny, isLoading: permissionsLoading } = usePermissions();
  const duocXemToanChuoi = hasAny(["reports.view_all_branches","system.manage_branches"]);
  const txPerms = useTxRowPermissions("production");
  const [data,setData]=useState<LotRow[]>([]);
  const [total,setTotal]=useState(0);
  const [summary,setSummary]=useState({activeCount:0,currentQty:0,expiredCount:0,nearExpiryCount:0});
  const [loading,setLoading]=useState(true);
  const [exporting,setExporting]=useState(false);
  const [page,setPage]=useState(0);
  const [pageSize,setPageSize]=useState(20);
  const [search,setSearch]=useState("");
  const debouncedSearch=useDebounce(search,300);
  const [searchField,setSearchField]=useState("all");
  const [statusFilters,setStatusFilters]=useState<string[]>([]);
  const [sourceFilters,setSourceFilters]=useState<string[]>([]);
  const [expiryState,setExpiryState]=useState<"all"|"expired"|"upcoming"|"no_expiry">("all");
  const [datePreset,setDatePreset]=useState<DatePresetValue>("all");
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [filterOpen,setFilterOpen]=useState(false);
  const [viewAllBranches,setViewAllBranches]=useState(false);
  const [otherBranchCount,setOtherBranchCount]=useState(0);
  const [auditDialogTarget,setAuditDialogTarget]=useState<LotRow|null>(null);
  const [assignExpiryOpen,setAssignExpiryOpen]=useState(false);

  useEffect(()=>setViewAllBranches(false),[activeBranchId]);
  useEffect(()=>{if(!duocXemToanChuoi)setViewAllBranches(false);},[duocXemToanChuoi]);
  useEffect(()=>setPage(0),[debouncedSearch,searchField,statusFilters,sourceFilters,expiryState,datePreset,dateFrom,dateTo,activeBranchId,viewAllBranches]);
  const buildQuery=useCallback(()=>({
    search:debouncedSearch||undefined, searchField:searchField as "all"|"lot_number"|"product_code"|"product_name",
    statuses:statusFilters, sourceTypes:sourceFilters, expiryState, thresholdDays:30,
    receivedFrom:datePreset==="custom"?dateFrom||undefined:computeListPresetRange(datePreset).from,
    receivedToExclusive:nextDate(datePreset==="custom"?dateTo||undefined:computeListPresetRange(datePreset).to),
    branchId:duocXemToanChuoi&&viewAllBranches?undefined:activeBranchId,
  }),[activeBranchId,dateFrom,datePreset,dateTo,debouncedSearch,duocXemToanChuoi,expiryState,searchField,sourceFilters,statusFilters,viewAllBranches]);

  const fetchData=useCallback(async()=>{
    if(!isReady||permissionsLoading)return;
    setLoading(true);
    try{
      const query=buildQuery();
      const result=await getProductLotListWorkspace({...query,page,pageSize});
      setData(result.data);setTotal(result.total);setSummary(result.summary);
      if(duocXemToanChuoi&&!viewAllBranches&&activeBranchId&&result.total===0){
        const all=await getProductLotListWorkspace({...query,branchId:undefined,page:0,pageSize:1});setOtherBranchCount(all.total);
      }else setOtherBranchCount(0);
    }catch(error){toast({variant:"error",title:"Lỗi tải danh sách lô",description:error instanceof Error?error.message:"Vui lòng thử lại"});}
    finally{setLoading(false);}
  },[activeBranchId,buildQuery,duocXemToanChuoi,isReady,page,pageSize,permissionsLoading,toast,viewAllBranches]);
  useEffect(()=>{void fetchData();},[fetchData]);

  const handleExport=async()=>{
    setExporting(true);
    try{
      const rows=await getProductLotsForExport(buildQuery());
      await exportToExcel(rows,[
        {header:"Số lô",key:"lotNumber",width:20},{header:"Mã hàng",key:"productCode",width:18},
        {header:"Tên hàng",key:"productName",width:32},{header:"Nguồn",key:"sourceType",width:16,format:(v:string)=>sourceOptions.find(x=>x.value===v)?.label??v},
        {header:"Chi nhánh",key:"branchName",width:24},{header:"SL ban đầu",key:"initialQty",width:14},
        {header:"SL hiện tại",key:"currentQty",width:14},{header:"Ngày nhận",key:"receivedDate",width:16,format:(v:string)=>formatDate(v)},
        {header:"Hạn sử dụng",key:"expiryDate",width:16,format:(v:string)=>v?formatDate(v):""},
        {header:"Trạng thái",key:"status",width:16,format:(v:string)=>statusMap[v]?.label??v},
      ],"danh-sach-lo");
    }catch(error){toast({variant:"error",title:"Xuất file thất bại",description:error instanceof Error?error.message:"Vui lòng thử lại"});}
    finally{setExporting(false);}
  };
  const clearFilters=()=>{setStatusFilters([]);setSourceFilters([]);setExpiryState("all");setDatePreset("all");setDateFrom("");setDateTo("");};
  const chips:ListFilterChip[]=[
    ...(statusFilters.length?[{key:"status",label:"Trạng thái",value:statusFilters.map(v=>statusOptions.find(x=>x.value===v)?.label??v).join(", "),onClear:()=>setStatusFilters([])}]:[]),
    ...(sourceFilters.length?[{key:"source",label:"Nguồn",value:sourceFilters.map(v=>sourceOptions.find(x=>x.value===v)?.label??v).join(", "),onClear:()=>setSourceFilters([])}]:[]),
    ...(expiryState!=="all"?[{key:"expiry",label:"Hạn sử dụng",value:expiryOptions.find(x=>x.value===expiryState)?.label??expiryState,onClear:()=>setExpiryState("all")}]:[]),
    ...(datePreset!=="all"?[{key:"received",label:"Ngày nhận",value:datePreset==="custom"?`${dateFrom||"..."} đến ${dateTo||"..."}`:STANDARD_LIST_PRESETS_WITH_ALL.find(x=>x.value===datePreset)?.label??datePreset,onClear:()=>{setDatePreset("all");setDateFrom("");setDateTo("");}}]:[]),
  ];
  const columns:ColumnDef<LotRow>[]=[
    {accessorKey:"lotNumber",header:"Số lô",size:150,cell:({row})=><span className="font-mono text-xs font-semibold text-primary">{row.original.lotNumber}</span>},
    {accessorKey:"productName",header:"Sản phẩm",size:250,cell:({row})=><div className="min-w-0"><p className="truncate text-sm font-medium">{row.original.productName}</p><p className="font-mono text-xs text-muted-foreground">{row.original.productCode}</p></div>},
    {accessorKey:"sourceType",header:"Nguồn",size:110,cell:({row})=><span className="text-xs">{sourceOptions.find(x=>x.value===row.original.sourceType)?.label??row.original.sourceType}</span>},
    {accessorKey:"branchName",header:"Chi nhánh",size:160,cell:({row})=><span className="text-xs text-muted-foreground">{row.original.branchName||"—"}</span>},
    {accessorKey:"initialQty",header:"SL ban đầu",size:110,cell:({row})=><span className="text-xs tabular-nums">{formatNumber(row.original.initialQty)}</span>},
    {accessorKey:"currentQty",header:"SL hiện tại",size:120,cell:({row})=><span className="text-xs font-bold tabular-nums">{formatNumber(row.original.currentQty)}</span>},
    {accessorKey:"expiryDate",header:"Hạn sử dụng",size:145,cell:({row})=>row.original.expiryDate?<span className={(row.original.daysUntilExpiry??999)<0?"font-medium text-status-error":(row.original.daysUntilExpiry??999)<=30?"text-status-warning":"text-muted-foreground"}>{formatDate(row.original.expiryDate)}</span>:<span className="text-muted-foreground">—</span>},
    {accessorKey:"status",header:"Trạng thái",size:120,cell:({row})=>{const s=statusMap[row.original.status]??statusMap.active;return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${toneClass[s.tone]}`}><span className={`size-1.5 rounded-full ${dotClass[s.tone]}`}/>{s.label}</span>;}},
  ];

  return <ListPageLayout sidebar={null}>
    <PageHeader title="Lô sản xuất" density="compact" searchPlaceholder="Nhập nội dung cần tìm..." searchValue={search} onSearchChange={setSearch} searchFields={searchFields} searchField={searchField} onSearchFieldChange={setSearchField}
      actions={[{label:"Gắn HSD cho tồn cũ",icon:<Icon name="event" size={16}/>,variant:"default",onClick:()=>setAssignExpiryOpen(true)}]}
      onExport={{items:[{label:exporting?"Đang xuất...":"Xuất Excel danh sách lô",icon:"table_view",onClick:()=>{if(!exporting)void handleExport();}}]}}/>
    <DataTable columns={columns} data={data} loading={loading} total={total} density="compact" columnToggle getRowId={(row)=>row.id}
      pageIndex={page} pageSize={pageSize} pageCount={Math.max(1,Math.ceil(total/pageSize))} onPageChange={setPage} onPageSizeChange={(size)=>{setPageSize(size);setPage(0);}}
      toolbarMetrics={<><ListMetric label="Tổng lô" value={formatNumber(total)} tone="primary"/><ListMetric label="Đang hoạt động" value={formatNumber(summary.activeCount)}/><ListMetric label="Số lượng hiện tại" value={formatNumber(summary.currentQty)}/><ListMetric label={summary.expiredCount>0?"Đã hết hạn":"Sắp hết hạn (30 ngày)"} value={formatNumber(summary.expiredCount>0?summary.expiredCount:summary.nearExpiryCount)} tone={summary.expiredCount>0?"danger":"default"}/></>}
      toolbarActions={<Button type="button" variant="outline" size="sm" className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={()=>setFilterOpen(true)}><Icon name="filter_alt" size={15}/><span className="hidden sm:inline">Bộ lọc</span>{chips.length>0&&<span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">{chips.length}</span>}</Button>}
      toolbarFooter={<>{chips.length>0&&<FilterChips filters={chips} onClearAll={clearFilters}/>} {viewAllBranches&&<AllBranchesBanner entityLabel="lô" branchName={currentBranch?.name} onBackToBranch={()=>setViewAllBranches(false)}/>}</>}
      rowActions={(row)=>buildTransactionRowActions({row,kind:"production",permissions:txPerms,onAuditLog:()=>setAuditDialogTarget(row)})}
      emptyTitle="Chưa có lô phù hợp" emptyDescription="Thử thay đổi nội dung tìm kiếm hoặc bộ lọc." emptyIcon="inventory_2" emptyBranchHint={duocXemToanChuoi?{otherBranchCount,onViewAllBranches:()=>setViewAllBranches(true),entityLabel:"lô"}:undefined}/>
    <FilterPanel open={filterOpen} onOpenChange={setFilterOpen} activeCount={chips.length} onClearAll={clearFilters} title="Bộ lọc lô sản xuất">
      <FilterGroup label="Trạng thái"><CheckboxFilter options={statusOptions} selected={statusFilters} onChange={setStatusFilters}/></FilterGroup>
      <FilterGroup label="Nguồn"><CheckboxFilter options={sourceOptions} selected={sourceFilters} onChange={setSourceFilters}/></FilterGroup>
      <FilterGroup label="Hạn sử dụng"><SelectFilter options={expiryOptions} value={expiryState} onChange={(v)=>setExpiryState(v as typeof expiryState)}/></FilterGroup>
      <FilterGroup label="Ngày nhận hàng"><DatePresetFilter value={datePreset} onChange={setDatePreset} from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} presets={STANDARD_LIST_PRESETS_WITH_ALL}/></FilterGroup>
    </FilterPanel>
    {auditDialogTarget&&<AuditLogDialog entityType="product_lot" entityId={auditDialogTarget.id} entityCode={auditDialogTarget.lotNumber} onClose={()=>setAuditDialogTarget(null)}/>}
    <AssignExpiryDialog open={assignExpiryOpen} onOpenChange={setAssignExpiryOpen} onSaved={fetchData}/>
  </ListPageLayout>;
}
