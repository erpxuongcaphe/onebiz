"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  SelectFilter,
  DateRangeFilter,
} from "@/components/shared/filter-sidebar";
import { formatCurrency, formatDate } from "@/lib/format";

// === Types ===
interface CashBookEntry {
  id: string;
  code: string;
  date: string;
  type: "receipt" | "payment";
  typeName: string;
  category: string;
  counterparty: string;
  amount: number;
  note?: string;
  createdBy: string;
}

// === Generate 30 mock entries ===
function generateCashBookData(): CashBookEntry[] {
  const receiptCategories = [
    "Thu tiền khách hàng",
    "Thu tiền mặt",
    "Thu khác",
  ];
  const paymentCategories = [
    "Chi trả NCC",
    "Chi phí vận chuyển",
    "Chi phí khác",
  ];
  const counterparties = [
    "Nguyễn Minh Tuấn",
    "Trần Thị Hoa",
    "Công ty TNHH ABC Coffee",
    "Lê Văn Đức",
    "Phạm Mai Lan",
    "Hoàng Anh Dũng",
    "NCC Đại Phát",
    "NCC Minh Long",
    "Vũ Thị Ngọc",
    "Quán Cà Phê Bùi Thanh Tâm",
    "Công ty Phân Phối Miền Nam",
    "Giao Hàng Nhanh",
    "Viettel Post",
    "Đỗ Quang Huy",
    "Lê Hoàng Phúc",
  ];
  const creators = ["Nguyễn Văn A", "Trần Thị B", "Lê Văn C", "Phạm Thị D"];
  const notes = [
    "Thanh toán đơn hàng",
    "Thu nợ cũ",
    "Thanh toán công nợ NCC",
    "Phí giao hàng tháng 3",
    "Chi phí thuê kho",
    "Thu tiền trả hàng",
    undefined,
    undefined,
    "Tạm ứng",
    "Hoàn tiền khách",
  ];

  return Array.from({ length: 30 }, (_, i) => {
    const isReceipt = Math.random() > 0.45;
    const type: "receipt" | "payment" = isReceipt ? "receipt" : "payment";
    const categories = isReceipt ? receiptCategories : paymentCategories;
    const daysAgo = Math.floor(Math.random() * 60);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    date.setHours(
      Math.floor(Math.random() * 12) + 7,
      Math.floor(Math.random() * 60)
    );

    return {
      id: `cb_${i + 1}`,
      code: `${isReceipt ? "PT" : "PC"}${String(i + 1).padStart(5, "0")}`,
      date: date.toISOString(),
      type,
      typeName: isReceipt ? "Phiếu thu" : "Phiếu chi",
      category: categories[Math.floor(Math.random() * categories.length)],
      counterparty:
        counterparties[Math.floor(Math.random() * counterparties.length)],
      amount: Math.floor(Math.random() * 20000000) + 500000,
      note: notes[Math.floor(Math.random() * notes.length)],
      createdBy: creators[Math.floor(Math.random() * creators.length)],
    };
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

const allEntries = generateCashBookData();

// === Columns ===
const columns: ColumnDef<CashBookEntry, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã phiếu",
    size: 120,
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
    accessorKey: "typeName",
    header: "Loại",
    size: 110,
    cell: ({ row }) => {
      const variant =
        row.original.type === "receipt" ? "default" : "destructive";
      return <Badge variant={variant}>{row.original.typeName}</Badge>;
    },
  },
  {
    accessorKey: "category",
    header: "Danh mục",
    size: 160,
  },
  {
    accessorKey: "counterparty",
    header: "Đối tượng",
    size: 180,
  },
  {
    accessorKey: "amount",
    header: "Số tiền",
    cell: ({ row }) => {
      const isReceipt = row.original.type === "receipt";
      return (
        <span
          className={`font-medium ${
            isReceipt ? "text-green-600" : "text-destructive"
          }`}
        >
          {isReceipt ? "+" : "-"}
          {formatCurrency(row.original.amount)}
        </span>
      );
    },
  },
  {
    accessorKey: "note",
    header: "Ghi chú",
    size: 180,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.note || "—"}
      </span>
    ),
  },
  {
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 130,
  },
];

export default function SoQuyPage() {
  const [data, setData] = useState<CashBookEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");

  // Filters
  const [typeFilter, setTypeFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<
    "today" | "this_week" | "this_month" | "all" | "custom"
  >("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 200));

    let filtered = [...allEntries];

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.code.toLowerCase().includes(q) ||
          e.counterparty.toLowerCase().includes(q)
      );
    }

    if (typeFilter !== "all") {
      filtered = filtered.filter((e) => e.type === typeFilter);
    }

    const totalFiltered = filtered.length;
    const start = page * pageSize;
    const paged = filtered.slice(start, start + pageSize);

    setData(paged);
    setTotal(totalFiltered);
    setLoading(false);
  }, [search, typeFilter, page, pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Summary calculations
  const totalReceipt = allEntries
    .filter((e) => e.type === "receipt")
    .reduce((sum, e) => sum + e.amount, 0);
  const totalPayment = allEntries
    .filter((e) => e.type === "payment")
    .reduce((sum, e) => sum + e.amount, 0);

  const summaryRow: Record<string, string | number> = {
    code: "Tổng cộng",
    typeName: "",
    category: "",
    counterparty: "",
    amount: "",
    note: `Thu: ${formatCurrency(totalReceipt)} | Chi: ${formatCurrency(totalPayment)}`,
    createdBy: "",
    date: "",
  };

  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Loại phiếu">
            <SelectFilter
              options={[
                { label: "Phiếu thu", value: "receipt" },
                { label: "Phiếu chi", value: "payment" },
              ]}
              value={typeFilter}
              onChange={setTypeFilter}
              placeholder="Tất cả"
            />
          </FilterGroup>
          <FilterGroup label="Thời gian">
            <DateRangeFilter
              preset={datePreset}
              onPresetChange={setDatePreset}
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Sổ quỹ"
        searchPlaceholder="Theo mã phiếu, đối tượng"
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        actions={[
          {
            label: "Tạo phiếu thu",
            icon: <Plus className="h-4 w-4" />,
            variant: "default",
          },
          {
            label: "Tạo phiếu chi",
            icon: <Plus className="h-4 w-4" />,
            variant: "outline",
          },
        ]}
      />
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
        summaryRow={summaryRow}
      />
    </ListPageLayout>
  );
}
