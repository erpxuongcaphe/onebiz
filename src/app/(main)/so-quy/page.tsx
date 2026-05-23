"use client";

import { useEffect, useState, useCallback } from "react";
import { useRevalidateOnFocus } from "@/lib/hooks/use-revalidate-on-focus";
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
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { downloadTemplate } from "@/lib/excel";
import { cashTransactionExcelSchema } from "@/lib/excel/schemas";
import { bulkImportCashTransactions } from "@/lib/services/supabase/excel-import";
import { formatCurrency, formatDate, formatUser } from "@/lib/format";
import { exportToCsv } from "@/lib/utils/export";
import {
  exportReportToExcel,
  buildInfoSheet,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { exportToExcelFromSchema } from "@/lib/excel";
import type { CashTransactionImportRow } from "@/lib/excel/schemas";
import {
  getCashBookEntries,
  getCashBookSummaryAsync,
  cancelCashTransaction,
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
  const txPerms = useTxRowPermissions("cash_transaction");
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

  // Cancel (was "Delete" — Stage 5 anomaly fix: phiếu thu/chi đã chốt mà xoá
  // cứng nguy hiểm cho kế toán/đối soát. UX align với cancel flow.
  // CEO 13/05: refactor xong — dùng cancelCashTransaction (status='cancelled'
  // + audit log + reverse debt nếu có invoice/PO ref).
  const [deletingEntry, setDeletingEntry] = useState<CashBookEntry | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  // Sprint UX-1 Stage 4: Audit log shortcut
  const [auditDialogTarget, setAuditDialogTarget] = useState<CashBookEntry | null>(null);

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

  // CEO 23/05/2026: refetch khi tab visible/focus lại → fix bug F5 stale
  useRevalidateOnFocus(fetchData);

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

  // Day 2 16/05/2026: Excel sổ quỹ theo pattern focused-per-module
  //   - Sheet 0: Thông tin (Doanh nghiệp / Kỳ / Chi nhánh / Disclaimer)
  //   - Sheet 1: Sổ quỹ chi tiết (cột tiêu chuẩn KT — Mã / Ngày / Diễn giải /
  //     Nhóm / Đối tác / Thu / Chi / Số dư chạy)
  //   - Sheet 2: Tổng kết theo ngày (Thu / Chi / Tồn cuối ngày)
  //   - Sheet 3: Tổng kết theo nhóm bút toán
  //   - Có signature block (Người lập / Kế toán / Giám đốc)
  const handleExport = (type: "excel" | "csv") => {
    if (type === "excel") {
      const range = presetToRange(datePreset);
      const isoToYmd = (iso: string | undefined): string => {
        if (!iso) return new Date().toISOString().slice(0, 10);
        return iso.slice(0, 10);
      };

      // Sort data ascending by date for running balance
      const sortedData = [...data].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );

      // Sheet 1: Sổ quỹ chi tiết
      let runningBalance = openingBalance;
      const detailRows = sortedData.map((e) => {
        const thu = e.type === "receipt" ? e.amount : 0;
        const chi = e.type === "payment" ? e.amount : 0;
        runningBalance = runningBalance + thu - chi;
        return {
          code: e.code,
          date: formatDate(e.date),
          category: e.category,
          counterparty: e.counterparty ?? "",
          note: e.note ?? "",
          receipt: thu,
          payment: chi,
          balance: runningBalance,
        };
      });
      const detailSheet: ExcelSheet = {
        name: "Sổ quỹ chi tiết",
        titleRows: [
          "SỔ QUỸ CHI TIẾT",
          `Số dư đầu kỳ: ${formatCurrency(openingBalance)}`,
        ],
        columns: [
          { label: "Mã phiếu", key: "code", width: 14 },
          { label: "Ngày", key: "date", width: 14, format: "text" },
          { label: "Nhóm bút toán", key: "category", width: 22 },
          { label: "Đối tác", key: "counterparty", width: 24 },
          { label: "Diễn giải", key: "note", width: 32 },
          { label: "Thu", key: "receipt", width: 16, format: "currency" },
          { label: "Chi", key: "payment", width: 16, format: "currency" },
          { label: "Số dư", key: "balance", width: 18, format: "currency" },
        ],
        rows: detailRows,
        footer: {
          code: "",
          date: "",
          category: "",
          counterparty: "",
          note: "TỔNG CỘNG",
          receipt: totalReceipt,
          payment: totalPayment,
          balance: closingBalance,
        },
        footerLabel: `${detailRows.length} bút toán • Số dư cuối: ${formatCurrency(closingBalance)}`,
        withSignature: true,
      };

      // Sheet 2: Tổng kết theo ngày
      const dailyMap = new Map<
        string,
        { date: string; receipt: number; payment: number }
      >();
      for (const e of sortedData) {
        const dayKey = new Date(e.date).toISOString().slice(0, 10);
        const existing = dailyMap.get(dayKey) ?? {
          date: dayKey,
          receipt: 0,
          payment: 0,
        };
        if (e.type === "receipt") existing.receipt += e.amount;
        else existing.payment += e.amount;
        dailyMap.set(dayKey, existing);
      }
      let dailyBalance = openingBalance;
      const dailyRows = Array.from(dailyMap.values())
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => {
          const balanceStart = dailyBalance;
          dailyBalance = dailyBalance + r.receipt - r.payment;
          return {
            date: formatDate(r.date),
            balanceStart,
            receipt: r.receipt,
            payment: r.payment,
            balanceEnd: dailyBalance,
          };
        });
      const dailySheet: ExcelSheet = {
        name: "Tổng theo ngày",
        titleRows: ["TỔNG KẾT THEO NGÀY"],
        columns: [
          { label: "Ngày", key: "date", width: 14, format: "text" },
          { label: "Tồn đầu ngày", key: "balanceStart", width: 18, format: "currency" },
          { label: "Tổng thu", key: "receipt", width: 16, format: "currency" },
          { label: "Tổng chi", key: "payment", width: 16, format: "currency" },
          { label: "Tồn cuối ngày", key: "balanceEnd", width: 18, format: "currency" },
        ],
        rows: dailyRows,
        footer: {
          date: "TỔNG",
          balanceStart: openingBalance,
          receipt: totalReceipt,
          payment: totalPayment,
          balanceEnd: closingBalance,
        },
      };

      // Sheet 3: Tổng kết theo nhóm bút toán
      const groupMap = new Map<
        string,
        { category: string; receipt: number; payment: number; count: number }
      >();
      for (const e of sortedData) {
        const key = e.category ?? "(không phân loại)";
        const existing = groupMap.get(key) ?? {
          category: key,
          receipt: 0,
          payment: 0,
          count: 0,
        };
        if (e.type === "receipt") existing.receipt += e.amount;
        else existing.payment += e.amount;
        existing.count += 1;
        groupMap.set(key, existing);
      }
      const groupRows = Array.from(groupMap.values())
        .sort((a, b) => b.receipt + b.payment - (a.receipt + a.payment))
        .map((r) => ({
          category: r.category,
          count: r.count,
          receipt: r.receipt,
          payment: r.payment,
          netFlow: r.receipt - r.payment,
        }));
      const groupSheet: ExcelSheet = {
        name: "Tổng theo nhóm",
        titleRows: ["TỔNG KẾT THEO NHÓM BÚT TOÁN"],
        columns: [
          { label: "Nhóm bút toán", key: "category", width: 28 },
          { label: "Số bút toán", key: "count", width: 14, format: "number" },
          { label: "Tổng thu", key: "receipt", width: 16, format: "currency" },
          { label: "Tổng chi", key: "payment", width: 16, format: "currency" },
          { label: "Dòng tiền ròng", key: "netFlow", width: 18, format: "currency" },
        ],
        rows: groupRows,
        footer: {
          category: "TỔNG",
          count: detailRows.length,
          receipt: totalReceipt,
          payment: totalPayment,
          netFlow: totalReceipt - totalPayment,
        },
      };

      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO SỔ QUỸ",
        description: "Sổ quỹ chi tiết + tổng kết theo ngày + theo nhóm bút toán",
        range: {
          from: isoToYmd(range.from),
          to: isoToYmd(range.to),
        },
        branchName: activeBranchId ? "Chi nhánh đang chọn" : "Tất cả chi nhánh",
        tenantName: "OneBiz",
        generatedAt: new Date(),
        disclaimer:
          "Báo cáo quản trị nội bộ — không thay thế Báo cáo Tài chính theo TT200/133.",
      });

      try {
        exportReportToExcel({
          kind: "so-quy",
          mode: "full",
          range: {
            from: isoToYmd(range.from),
            to: isoToYmd(range.to),
          },
          branchName: activeBranchId ? "Chi nhánh đang chọn" : undefined,
          tenantName: "OneBiz",
          sheets: [infoSheet, detailSheet, dailySheet, groupSheet],
        });
        toast({
          title: "Đã xuất Excel sổ quỹ",
          description: `4 sheet: Info + Chi tiết (${detailRows.length}) + Theo ngày (${dailyRows.length}) + Theo nhóm (${groupRows.length})`,
          variant: "success",
        });
      } catch (err) {
        toast({
          title: "Lỗi xuất Excel",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
          variant: "error",
        });
      }
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
          selectable
          bulkActions={[
            {
              label: "Xuất Excel",
              icon: <Icon name="download" size={16} />,
              onClick: (selectedRows) => {
                const rows: CashTransactionImportRow[] = selectedRows.map(
                  (e) => ({
                    code: e.code,
                    date: new Date(e.date),
                    type: e.type,
                    category: e.category,
                    amount: e.amount,
                    counterparty: e.counterparty,
                    paymentMethod: "cash",
                    note: e.note,
                  }),
                );
                exportToExcelFromSchema(rows, cashTransactionExcelSchema);
                toast({
                  title: "Đã xuất Excel",
                  description: `${selectedRows.length} phiếu thu/chi`,
                  variant: "success",
                });
              },
            },
            {
              label: "In hàng loạt",
              icon: <Icon name="print" size={16} />,
              onClick: (selectedRows) => {
                selectedRows.forEach((row) =>
                  printDocument(buildCashTransactionPrintData(row)),
                );
              },
            },
            {
              label: "Hủy hàng loạt",
              icon: <Icon name="cancel" size={16} />,
              variant: "destructive",
              onClick: async (selectedRows) => {
                if (
                  !window.confirm(
                    `Hủy ${selectedRows.length} phiếu thu/chi? Thao tác này không thể hoàn tác.`,
                  )
                )
                  return;
                try {
                  await Promise.all(
                    selectedRows.map((r) =>
                      cancelCashTransaction(r.id, "Hủy hàng loạt từ UI sổ quỹ"),
                    ),
                  );
                  toast({
                    title: `Đã hủy ${selectedRows.length} phiếu`,
                    variant: "success",
                  });
                  await fetchData();
                } catch (err) {
                  toast({
                    title: "Lỗi hủy hàng loạt",
                    description:
                      err instanceof Error ? err.message : "Vui lòng thử lại",
                    variant: "error",
                  });
                }
              },
            },
          ]}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={(entry, onClose) => (
            <TransactionDetail
              entry={entry}
              onClose={onClose}
              onDelete={() => setDeletingEntry(entry)}
            />
          )}
          rowActions={(row) =>
            buildTransactionRowActions({
              row,
              kind: "cash_transaction",
              permissions: txPerms,
              onView: () => {
                const idx = data.findIndex((d) => d.id === row.id);
                setExpandedRow(expandedRow === idx ? null : idx);
              },
              onPrint: () => printDocument(buildCashTransactionPrintData(row)),
              onAuditLog: () => setAuditDialogTarget(row),
              // Stage 5b: đổi "Xóa" → "Hủy" (phiếu thu/chi đã chốt không
              // xoá cứng — dùng cancelCashTransaction với reason + audit log).
              onCancel: () => setDeletingEntry(row),
            })
          }
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
        onOpenChange={(open) => {
          if (!open) {
            setDeletingEntry(null);
            setDeleteReason("");
          }
        }}
        title="Hủy phiếu thu/chi"
        description={
          <div className="space-y-3">
            <p>
              Bạn có chắc muốn hủy phiếu <strong>{deletingEntry?.code}</strong>?
              Phiếu sẽ được đánh dấu cancelled (giữ lại để audit).
            </p>
            <div className="space-y-1">
              <label
                htmlFor="cancel-reason"
                className="text-xs font-medium block"
              >
                Lý do hủy <span className="text-status-error">*</span>
              </label>
              <textarea
                id="cancel-reason"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="VD: Nhập nhầm số tiền, sai bên / hủy đối ứng đơn..."
                className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={deleteLoading}
              />
            </div>
          </div>
        }
        confirmLabel="Hủy phiếu"
        cancelLabel="Đóng"
        variant="destructive"
        loading={deleteLoading}
        confirmDisabled={deleteReason.trim().length < 3}
        onConfirm={async () => {
          if (!deletingEntry) return;
          const reasonTrim = deleteReason.trim();
          if (reasonTrim.length < 3) {
            toast({
              title: "Cần ghi lý do",
              description: "Nhập ít nhất 3 ký tự để audit log truy được.",
              variant: "error",
            });
            return;
          }
          setDeleteLoading(true);
          try {
            await cancelCashTransaction(deletingEntry.id, reasonTrim);
            toast({
              title: "Đã hủy phiếu",
              description: `${deletingEntry.code} — ${reasonTrim}`,
              variant: "success",
            });
            setDeletingEntry(null);
            setDeleteReason("");
            fetchData();
          } catch (err) {
            toast({
              title: "Lỗi hủy phiếu",
              description:
                err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
          } finally {
            setDeleteLoading(false);
          }
        }}
      />

      {auditDialogTarget && (
        <AuditLogDialog
          entityType="cash_transaction"
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.code}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}

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
