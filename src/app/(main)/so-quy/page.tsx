"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
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
  getCashBookTypes,
  getCashBookSummary,
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
const statusFilterOptions = [
  { label: "Hoàn thành", value: "completed" },
  { label: "Phiếu tạm", value: "pending" },
  { label: "Đã hủy", value: "cancelled" },
];

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
                  title={entry.counterparty}
                  code={entry.code}
                  status={{
                    label: isReceipt ? "Phiếu thu" : "Phiếu chi",
                    variant: isReceipt ? "default" : "destructive",
                    className: isReceipt
                      ? "bg-status-success/10 text-status-success border-status-success/25"
                      : undefined,
                  }}
                  subtitle="Chi nhánh trung tâm"
                  meta={
                    <div className="flex items-center gap-4 flex-wrap text-xs">
                      <span>
                        Người tạo: <strong>{formatUser(entry.createdByName, entry.createdBy)}</strong>
                      </span>
                      <span>
                        Ngày tạo: <strong>{formatDate(entry.date)}</strong>
                      </span>
                      <span>
                        Loại thu chi: <strong>{entry.category}</strong>
                      </span>
                    </div>
                  }
                />

                <DetailInfoGrid
                  fields={[
                    { label: "Mã phiếu", value: entry.code },
                    { label: "Loại phiếu", value: entry.typeName },
                    { label: "Người nộp/nhận", value: entry.counterparty },
                    { label: "Loại thu chi", value: entry.category },
                    {
                      label: "Giá trị",
                      value: formatCurrency(entry.amount),
                    },
                    { label: "Ghi chú", value: entry.note || "---" },
                  ]}
                />

                {/* Notes area */}
                <div className="border rounded-md p-3">
                  <textarea
                    placeholder="Ghi chú..."
                    defaultValue={entry.note ?? ""}
                    className="w-full text-sm resize-none bg-transparent outline-none min-h-[60px]"
                  />
                </div>
              </div>
            ),
          },
          {
            id: "history",
            label: "Lịch sử",
            content: (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Chưa có lịch sử thay đổi
              </div>
            ),
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

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getCashBookEntries({
      page,
      pageSize,
      search,
      branchId: activeBranchId,
      filters: {
        ...(selectedDocTypes.length === 1 && { type: selectedDocTypes[0] }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [search, selectedDocTypes, page, pageSize, activeBranchId]);

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

  // Summary calculations
  const { totalReceipt, totalPayment } = getCashBookSummary();
  const openingBalance = 5000000; // Quỹ đầu kỳ placeholder
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

        {/* Summary row */}
        <div className="flex items-center gap-6 px-4 py-2 border-b bg-muted/30 text-sm">
          <div>
            Quỹ đầu kỳ:{" "}
            <span className="font-semibold">
              {formatCurrency(openingBalance)}
            </span>
          </div>
          <div>
            Tổng thu:{" "}
            <span className="font-semibold text-primary">
              {formatCurrency(totalReceipt)}
            </span>
          </div>
          <div>
            Tổng chi:{" "}
            <span className="font-semibold text-status-error">
              {formatCurrency(totalPayment)}
            </span>
          </div>
          <div>
            Tồn quỹ:{" "}
            <span className="font-semibold">
              {formatCurrency(closingBalance)}
            </span>
          </div>
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
