"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import { SummaryCard } from "@/components/shared/summary-card";
import {
  FilterSidebar,
  FilterGroup,
  RadioFilter,
  CheckboxFilter,
  SelectFilter,
  DatePresetFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  DetailItemsTable,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import { CreateCashTransactionDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { downloadTemplate } from "@/lib/excel";
import { cashTransactionExcelSchema } from "@/lib/excel/schemas";
import { bulkImportCashTransactions } from "@/lib/services/supabase/excel-import";
import { formatCurrency, formatDate, formatUser } from "@/lib/format";
import { exportToCsv } from "@/lib/utils/export";
import { exportToExcelFromSchema } from "@/lib/excel";
import type { CashTransactionImportRow } from "@/lib/excel/schemas";
import {
  getCashBookEntries,
  getCashBookSummaryAsync,
  deleteCashTransaction,
} from "@/lib/services";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { printDocument } from "@/lib/print-document";
import { buildCashTransactionPrintData } from "@/lib/print-templates";
import type { CashBookEntry } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

// === Status map ===
const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  completed: { label: "Hoàn thành", variant: "default" },
  pending: { label: "Phiếu tạm", variant: "secondary" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

// === Fund type options ===
const fundTypeOptions = [
  { label: "Tiền mặt", value: "cash" },
  { label: "Ngân hàng", value: "bank" },
  { label: "Ví điện tử", value: "ewallet" },
  { label: "Tổng quỹ", value: "all" },
];

// === Document type options ===
const documentTypeOptions = [
  { label: "Phiếu thu", value: "receipt" },
  { label: "Phiếu chi", value: "payment" },
];

// === Thu chi category options ===
const thuChiCategoryOptions = [
  { value: "all", label: "Tất cả" },
  { value: "thu_tien_khach", label: "Thu tiền khách hàng" },
  { value: "thu_tien_mat", label: "Thu tiền mặt" },
  { value: "thu_khac", label: "Thu khác" },
  { value: "chi_tra_ncc", label: "Chi trả NCC" },
  { value: "chi_phi_van_chuyen", label: "Chi phí vận chuyển" },
  { value: "chi_phi_khac", label: "Chi phí khác" },
];

// === Status filter options ===
// Note: DB schema chưa có cột `status` (sẽ thêm ở migration SỔ-QUỸ-2).
// Filter này hiện chỉ là UI placeholder — không tham gia query backend.
const statusFilterOptions = [
  { label: "Hoàn thành", value: "completed" },
  { label: "Phiếu tạm", value: "pending" },
  { label: "Đã hủy", value: "cancelled" },
];

// Map slug → label tiếng Việt cho category. Trước đây render raw slug
// (`customer_payment`, `chi_tra_ncc`...) → user không hiểu.
const CATEGORY_LABELS: Record<string, string> = {
  customer_payment: "Thu tiền khách hàng",
  thu_tien_khach: "Thu tiền khách hàng",
  thu_tien_mat: "Thu tiền mặt",
  thu_khac: "Thu khác",
  supplier_payment: "Chi trả NCC",
  chi_tra_ncc: "Chi trả NCC",
  chi_phi_van_chuyen: "Chi phí vận chuyển",
  chi_phi_khac: "Chi phí khác",
  salary: "Lương nhân viên",
  rent: "Tiền thuê",
  utility: "Điện nước",
};

function categoryLabel(c: string | undefined | null): string {
  if (!c) return "—";
  return CATEGORY_LABELS[c] ?? c;
}

// Convert DatePresetValue → ISO date range để pass vào service.
// Trả undefined cho "all" hoặc "custom" without dateFrom/dateTo.
function presetToRange(preset: string): {
  from: string | undefined;
  to: string | undefined;
} {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const toISO = (d: Date) => d.toISOString();
  switch (preset) {
    case "today":
      return { from: toISO(today), to: toISO(today) };
    case "yesterday": {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: toISO(y), to: toISO(y) };
    }
    case "this_week": {
      const dow = today.getDay() || 7; // CN=7
      const start = new Date(today);
      start.setDate(start.getDate() - dow + 1);
      return { from: toISO(start), to: toISO(today) };
    }
    case "this_month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: toISO(start), to: toISO(today) };
    }
    case "last_month": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: toISO(start), to: toISO(end) };
    }
    default:
      return { from: undefined, to: undefined };
  }
}

// === Inline Detail ===
function TransactionDetail({
  entry,
  onClose,
  onDelete,
}: {
  entry: CashBookEntry;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const isReceipt = entry.type === "receipt";

  return (
    <InlineDetailPanel open onClose={onClose} onDelete={onDelete}>
      <DetailTabs
        tabs={[
          {
            id: "info",
            label: "Thông tin",
            content: (
              <div className="space-y-4">
                <DetailHeader
                  title={entry.counterparty || categoryLabel(entry.category)}
                  code={entry.code}
                  status={{
                    label: isReceipt ? "Phiếu thu" : "Phiếu chi",
                    variant: isReceipt ? "default" : "destructive",
                    className: isReceipt
                      ? "bg-status-success/10 text-status-success border-status-success/25"
                      : undefined,
                  }}
                  // Resolve branch name từ row.branches (đã join). Trước đây
                  // hardcode "Chi nhánh trung tâm" → leak label sai khi xem
                  // phiếu của quán FnB / xưởng rang.
                  subtitle={entry.branchName || "—"}
                  meta={
                    <div className="flex items-center gap-4 flex-wrap text-xs">
                      <span>
                        Người tạo: <strong>{formatUser(entry.createdByName, entry.createdBy)}</strong>
                      </span>
                      <span>
                        Ngày tạo: <strong>{formatDate(entry.date)}</strong>
                      </span>
                      <span>
                        Loại thu chi: <strong>{categoryLabel(entry.category)}</strong>
                      </span>
                    </div>
                  }
                />

                <DetailInfoGrid
                  fields={[
                    { label: "Mã phiếu", value: entry.code },
                    { label: "Loại phiếu", value: entry.typeName },
                    { label: "Chi nhánh", value: entry.branchName || "—" },
                    { label: "Người nộp/nhận", value: entry.counterparty },
                    { label: "Loại thu chi", value: categoryLabel(entry.category) },
                    {
                      label: "Phương thức",
                      value:
                        entry.paymentMethod === "cash"
                          ? "Tiền mặt"
                          : entry.paymentMethod === "transfer"
                            ? "Chuyển khoản"
                            : entry.paymentMethod === "card"
                              ? "Thẻ"
                              : entry.paymentMethod === "ewallet"
                                ? "Ví điện tử"
                                : "—",
                    },
                    {
                      label: "Giá trị",
                      value: formatCurrency(entry.amount),
                    },
                    { label: "Ghi chú", value: entry.note || "—", fullWidth: true },
                  ]}
                />
              </div>
            ),
          },
          {
            id: "history",
            label: "Lịch sử",
            content: <AuditHistoryTab entityType="cash_transaction" entityId={entry.id} />,
          },
        ]}
      />
    </InlineDetailPanel>
  );
}

// === Page Component ===
export default function SoQuyPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const [data, setData] = useState<CashBookEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [search, setSearch] = useState("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<"receipt" | "payment">(
    "receipt",
  );
  const [importOpen, setImportOpen] = useState(false);

  // Delete
  const [deletingEntry, setDeletingEntry] = useState<CashBookEntry | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Filters
  const [fundType, setFundType] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");
  const [selectedDocTypes, setSelectedDocTypes] = useState<string[]>([
    "receipt",
    "payment",
  ]);
  const [thuChiCategory, setThuChiCategory] = useState("all");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "completed",
    "pending",
  ]);

  // Summary state — load async theo branch + period; trước đây dùng
  // `getCashBookSummary()` sync stub trả {0,0} + openingBalance hardcode
  // 5tr → KPI sai hoàn toàn trên production.
  const [summary, setSummary] = useState({
    totalReceipt: 0,
    totalPayment: 0,
    openingBalance: 0,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    const range = presetToRange(datePreset);
    const filters: Record<string, string | string[]> = {};
    if (selectedDocTypes.length === 1) filters.type = selectedDocTypes[0];
    if (fundType !== "all") filters.paymentMethod = fundType;
    if (thuChiCategory !== "all") filters.category = thuChiCategory;
    if (range.from) filters.dateFrom = range.from;
    if (range.to) filters.dateTo = range.to;

    const [listResult, summaryResult] = await Promise.all([
      getCashBookEntries({
        page,
        pageSize,
        search,
        branchId: activeBranchId,
        filters,
      }),
      getCashBookSummaryAsync({
        branchId: activeBranchId,
        dateFrom: range.from,
        dateTo: range.to,
      }).catch(() => ({ totalReceipt: 0, totalPayment: 0, openingBalance: 0 })),
    ]);
    setData(listResult.data);
    setTotal(listResult.total);
    setSummary(summaryResult);
    setLoading(false);
  }, [
    search,
    selectedDocTypes,
    page,
    pageSize,
    activeBranchId,
    fundType,
    thuChiCategory,
    datePreset,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, fundType, datePreset, selectedDocTypes, thuChiCategory, selectedStatuses]);

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Summary calculations từ DB (đã filter theo period + branch)
  const { totalReceipt, totalPayment, openingBalance } = summary;
  const closingBalance = openingBalance + totalReceipt - totalPayment;

  const handleExport = (type: "excel" | "csv") => {
    if (type === "excel") {
      const rows: CashTransactionImportRow[] = data.map((e) => ({
        code: e.code,
        date: new Date(e.date),
        type: e.type,
        category: e.category,
        amount: e.amount,
        counterparty: e.counterparty,
        paymentMethod: "cash",
        note: e.note,
      }));
      exportToExcelFromSchema(rows, cashTransactionExcelSchema);
      return;
    }
    const exportColumns = [
      { header: "Mã phiếu", key: "code", width: 15 },
      { header: "Thời gian", key: "date", width: 18, format: (v: string) => formatDate(v) },
      { header: "Loại thu chi", key: "category", width: 20 },
      { header: "Người nộp/nhận", key: "counterparty", width: 22 },
      { header: "Giá trị", key: "amount", width: 15, format: (v: number) => v },
    ];
    exportToCsv(data, exportColumns, "so-quy");
  };

  // === Columns ===
  const columns: ColumnDef<CashBookEntry, unknown>[] = [
    {
      id: "star",
      header: "",
      size: 36,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <StarCell
          starred={starred.has(row.original.id)}
          onToggle={() => toggleStar(row.original.id)}
        />
      ),
    },
    {
      accessorKey: "code",
      header: "Mã phiếu",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "date",
      header: "Thời gian",
      size: 150,
      cell: ({ row }) => formatDate(row.original.date),
    },
    {
      accessorKey: "category",
      header: "Loại thu chi",
      size: 180,
      cell: ({ row }) => (
        <span className="text-sm">{categoryLabel(row.original.category)}</span>
      ),
    },
    {
      accessorKey: "branchName",
      header: "Chi nhánh",
      size: 140,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.branchName || "—"}
        </span>
      ),
    },
    {
      accessorKey: "counterparty",
      header: "Người nộp/nhận",
      size: 180,
    },
    {
      accessorKey: "amount",
      header: "Giá trị",
      cell: ({ row }) => {
        const isReceipt = row.original.type === "receipt";
        const displayAmount = isReceipt
          ? row.original.amount
          : -row.original.amount;
        return (
          <span
            className={`font-medium text-right block ${
              displayAmount < 0 ? "text-status-error" : "text-foreground"
            }`}
          >
            {formatCurrency(displayAmount)}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <ListPageLayout
        sidebar={
          <FilterSidebar>
            <FilterGroup label="Quỹ tiền">
              <RadioFilter
                options={fundTypeOptions}
                value={fundType}
                onChange={setFundType}
                name="fund-type"
              />
            </FilterGroup>

            <FilterGroup label="Thời gian">
              <DatePresetFilter
                value={datePreset}
                onChange={setDatePreset}
              />
            </FilterGroup>

            <FilterGroup label="Loại chứng từ">
              <CheckboxFilter
                options={documentTypeOptions}
                selected={selectedDocTypes}
                onChange={setSelectedDocTypes}
              />
            </FilterGroup>

            <FilterGroup label="Loại thu chi">
              <SelectFilter
                options={thuChiCategoryOptions}
                value={thuChiCategory}
                onChange={setThuChiCategory}
                placeholder="Tất cả"
              />
            </FilterGroup>

            <FilterGroup label="Trạng thái">
              <CheckboxFilter
                options={statusFilterOptions}
                selected={selectedStatuses}
                onChange={setSelectedStatuses}
              />
            </FilterGroup>
          </FilterSidebar>
        }
      >
        <PageHeader
          title="Sổ quỹ tiền mặt"
          searchPlaceholder="Theo mã phiếu, người nộp/nhận"
          searchValue={search}
          onSearchChange={setSearch}
          onExport={{
            excel: () => handleExport("excel"),
            csv: () => handleExport("csv"),
          }}
          actions={[
            {
              label: "+ Phiếu thu",
              icon: <Icon name="add" size={16} />,
              variant: "default",
              onClick: () => {
                setCreateType("receipt");
                setCreateOpen(true);
              },
            },
            {
              label: "+ Phiếu chi",
              icon: <Icon name="add" size={16} />,
              variant: "outline",
              onClick: () => {
                setCreateType("payment");
                setCreateOpen(true);
              },
            },
            {
              label: "Tải mẫu",
              icon: <Icon name="description" size={16} />,
              variant: "ghost",
              onClick: () => downloadTemplate(cashTransactionExcelSchema),
            },
            {
              label: "Nhập Excel",
              icon: <Icon name="upload" size={16} />,
              variant: "ghost",
              onClick: () => setImportOpen(true),
            },
          ]}
        />

        {/* KPI row — đồng nhất design với các module khác */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-4">
          <SummaryCard
            icon={<Icon name="savings" size={16} />}
            label="Quỹ đầu kỳ"
            value={formatCurrency(openingBalance)}
          />
          <SummaryCard
            icon={<Icon name="south_west" size={16} />}
            label="Tổng thu"
            value={formatCurrency(totalReceipt)}
          />
          <SummaryCard
            icon={<Icon name="north_east" size={16} />}
            label="Tổng chi"
            value={formatCurrency(totalPayment)}
            danger={totalPayment > totalReceipt}
          />
          <SummaryCard
            icon={<Icon name="account_balance_wallet" size={16} />}
            label="Tồn quỹ"
            value={formatCurrency(closingBalance)}
            highlight
          />
        </div>

        <DataTable
          columns={columns}
          data={data}
          loading={loading}
          total={total}
          pageIndex={page}
          pageSize={pageSize}
          pageCount={Math.ceil(total / pageSize)}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={(entry, onClose) => (
            <TransactionDetail
              entry={entry}
              onClose={onClose}
              onDelete={() => setDeletingEntry(entry)}
            />
          )}
          rowActions={(row) => [
            {
              label: "Xem chi tiết",
              icon: <Icon name="visibility" size={16} />,
              onClick: () => {
                const idx = data.findIndex((d) => d.id === row.id);
                setExpandedRow(expandedRow === idx ? null : idx);
              },
            },
            {
              label: "In phiếu",
              icon: <Icon name="print" size={16} />,
              onClick: () => printDocument(buildCashTransactionPrintData(row)),
            },
            {
              label: "Xóa",
              icon: <Icon name="delete" size={16} />,
              onClick: () => setDeletingEntry(row),
              variant: "destructive",
              separator: true,
            },
          ]}
        />
      </ListPageLayout>

      <CreateCashTransactionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultType={createType}
        onSuccess={fetchData}
      />

      <ConfirmDialog
        open={!!deletingEntry}
        onOpenChange={(open) => { if (!open) setDeletingEntry(null); }}
        title="Xóa phiếu thu/chi"
        description={`Xóa phiếu ${deletingEntry?.code}?`}
        confirmLabel="Xóa"
        variant="destructive"
        loading={deleteLoading}
        onConfirm={async () => {
          if (!deletingEntry) return;
          setDeleteLoading(true);
          try {
            await deleteCashTransaction(deletingEntry.id);
            toast({ title: "Đã xóa phiếu", description: deletingEntry.code, variant: "success" });
            setDeletingEntry(null);
            fetchData();
          } catch (err) {
            toast({ title: "Lỗi xóa phiếu", description: err instanceof Error ? err.message : "Vui lòng thử lại", variant: "error" });
          } finally {
            setDeleteLoading(false);
          }
        }}
      />

      <ImportExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        schema={cashTransactionExcelSchema}
        onCommit={bulkImportCashTransactions}
        onFinished={() => {
          setPage(0);
          fetchData();
          toast({
            title: "Nhập Excel hoàn tất",
            description: "Sổ quỹ đã được cập nhật với các phiếu mới.",
            variant: "success",
          });
        }}
      />
    </>
  );
}
