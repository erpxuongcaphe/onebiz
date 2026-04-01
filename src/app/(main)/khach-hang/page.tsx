"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Upload, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  CheckboxFilter,
  DatePresetFilter,
  ChipToggleFilter,
  PersonFilter,
} from "@/components/shared/filter-sidebar";
import type { DatePresetValue } from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { CreateCustomerDialog } from "@/components/shared/dialogs";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getCustomers, getCustomerGroups } from "@/lib/services";
import type { Customer } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Starred set (local state — could be persisted to backend later)   */
/* ------------------------------------------------------------------ */
function useStarredSet() {
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { starred, toggle };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function KhachHangPage() {
  const [data, setData] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  // Filters
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [genderFilter, setGenderFilter] = useState("all");
  const [debtFilter, setDebtFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");

  // Inline detail
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Dialog
  const [createOpen, setCreateOpen] = useState(false);

  // Stars
  const { starred, toggle: toggleStar } = useStarredSet();

  const customerGroups = getCustomerGroups();

  /* ---- Columns (defined inside component so we can access starred) ---- */
  const columns: ColumnDef<Customer, unknown>[] = [
    {
      id: "star",
      header: "",
      size: 40,
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
      header: "Ma KH",
      size: 110,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "Ten KH",
      size: 240,
    },
    {
      accessorKey: "phone",
      header: "Dien thoai",
      size: 130,
    },
    {
      accessorKey: "currentDebt",
      header: "No hien tai",
      cell: ({ row }) => {
        const debt = row.original.currentDebt;
        return (
          <span
            className={
              debt > 0 ? "text-destructive" : "text-muted-foreground"
            }
          >
            {formatCurrency(debt)}
          </span>
        );
      },
    },
    {
      accessorKey: "totalSales",
      header: "Tong ban",
      cell: ({ row }) => formatCurrency(row.original.totalSales),
    },
    {
      accessorKey: "totalSalesMinusReturns",
      header: "Tong ban tru tra hang",
      cell: ({ row }) => formatCurrency(row.original.totalSalesMinusReturns),
    },
  ];

  /* ---- Fetch data ---- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getCustomers({
      page,
      pageSize,
      search,
      filters: {
        ...(selectedGroups.length > 0 && { group: selectedGroups }),
        ...(typeFilter !== "all" && { type: typeFilter }),
        ...(genderFilter !== "all" && { gender: genderFilter }),
        ...(debtFilter !== "all" && { debt: debtFilter }),
        ...(creatorFilter && { createdBy: creatorFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [
    page,
    pageSize,
    search,
    selectedGroups,
    typeFilter,
    genderFilter,
    debtFilter,
    creatorFilter,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [search, selectedGroups, typeFilter, genderFilter, debtFilter, creatorFilter]);

  /* ---- Summaries ---- */
  const totalDebt = data.reduce((sum, c) => sum + c.currentDebt, 0);
  const totalSales = data.reduce((sum, c) => sum + c.totalSales, 0);
  const totalSalesMinusReturns = data.reduce(
    (sum, c) => sum + c.totalSalesMinusReturns,
    0
  );

  /* ---- Export ---- */
  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Ma KH", key: "code", width: 12 },
      { header: "Ten khach hang", key: "name", width: 25 },
      { header: "SDT", key: "phone", width: 15 },
      { header: "Email", key: "email", width: 25 },
      { header: "No hien tai", key: "currentDebt", width: 15, format: (v: number) => v },
      { header: "Tong ban", key: "totalSales", width: 15, format: (v: number) => v },
      { header: "Nhom", key: "groupName", width: 20 },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "danh-sach-khach-hang");
    else exportToCsv(data, exportColumns, "danh-sach-khach-hang");
  };

  /* ---- Inline detail renderer ---- */
  const renderDetail = (customer: Customer, onClose: () => void) => {
    const tabs: DetailTab[] = [
      {
        id: "info",
        label: "Thong tin",
        content: (
          <DetailInfoGrid
            columns={3}
            fields={[
              { label: "Ma khach hang", value: customer.code },
              { label: "Ten khach hang", value: customer.name },
              { label: "Dien thoai", value: customer.phone },
              { label: "Email", value: customer.email || "" },
              { label: "Dia chi", value: customer.address || "", fullWidth: true },
              { label: "Nhom khach hang", value: customer.groupName || "" },
              {
                label: "Loai khach hang",
                value: customer.type === "company" ? "Cong ty" : "Ca nhan",
              },
              {
                label: "Gioi tinh",
                value:
                  customer.gender === "male"
                    ? "Nam"
                    : customer.gender === "female"
                      ? "Nu"
                      : "",
              },
              { label: "Ngay tao", value: formatDate(customer.createdAt) },
            ]}
          />
        ),
      },
      {
        id: "address",
        label: "Dia chi nhan hang",
        content: (
          <div className="text-sm text-muted-foreground py-4">
            {customer.address || "Chua co dia chi nhan hang nao."}
          </div>
        ),
      },
      {
        id: "sales-history",
        label: "Lich su ban/tra hang",
        content: (
          <div className="text-sm text-muted-foreground py-4">
            Chua co lich su ban/tra hang.
          </div>
        ),
      },
      {
        id: "debt",
        label: "No can thu tu khach",
        content: (
          <DetailInfoGrid
            columns={2}
            fields={[
              {
                label: "No hien tai",
                value: (
                  <span
                    className={
                      customer.currentDebt > 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {formatCurrency(customer.currentDebt)}
                  </span>
                ),
              },
              {
                label: "Tong ban",
                value: formatCurrency(customer.totalSales),
              },
            ]}
          />
        ),
      },
      {
        id: "points",
        label: "Lich su tich diem",
        content: (
          <div className="text-sm text-muted-foreground py-4">
            Chua co lich su tich diem.
          </div>
        ),
      },
    ];

    return (
      <InlineDetailPanel open onClose={onClose}>
        <div className="p-4 space-y-4">
          <DetailHeader
            title={customer.name}
            code={customer.code}
            subtitle={customer.groupName}
            meta={
              <span>
                Ngay tao: {formatDate(customer.createdAt)}
              </span>
            }
          />
          <DetailTabs tabs={tabs} defaultTab="info" />
        </div>
      </InlineDetailPanel>
    );
  };

  /* ---- Render ---- */
  return (
    <>
      <ListPageLayout
        sidebar={
          <FilterSidebar>
            <FilterGroup label="Nhom khach hang">
              <CheckboxFilter
                options={customerGroups}
                selected={selectedGroups}
                onChange={setSelectedGroups}
              />
            </FilterGroup>

            <FilterGroup label="Loai khach hang">
              <ChipToggleFilter
                options={[
                  { label: "Tat ca", value: "all" },
                  { label: "Ca nhan", value: "individual" },
                  { label: "Cong ty", value: "company" },
                ]}
                value={typeFilter}
                onChange={setTypeFilter}
              />
            </FilterGroup>

            <FilterGroup label="Gioi tinh">
              <ChipToggleFilter
                options={[
                  { label: "Tat ca", value: "all" },
                  { label: "Nam", value: "male" },
                  { label: "Nu", value: "female" },
                ]}
                value={genderFilter}
                onChange={setGenderFilter}
              />
            </FilterGroup>

            <FilterGroup label="Thoi gian">
              <DatePresetFilter
                value={datePreset}
                onChange={setDatePreset}
                from={dateFrom}
                to={dateTo}
                onFromChange={setDateFrom}
                onToChange={setDateTo}
                presets={[
                  { label: "Tat ca", value: "all" },
                  { label: "Hom nay", value: "today" },
                  { label: "Hom qua", value: "yesterday" },
                  { label: "Tuan nay", value: "this_week" },
                  { label: "Thang nay", value: "this_month" },
                  { label: "Thang truoc", value: "last_month" },
                  { label: "Tuy chinh", value: "custom" },
                ]}
              />
            </FilterGroup>

            <FilterGroup label="Nguoi tao">
              <PersonFilter
                value={creatorFilter}
                onChange={setCreatorFilter}
                placeholder="Chon nguoi tao"
                suggestions={[
                  { label: "Admin", value: "admin" },
                  { label: "Cao Thi Huyen Trang", value: "trang" },
                ]}
              />
            </FilterGroup>
          </FilterSidebar>
        }
      >
        <PageHeader
          title="Khach hang"
          searchPlaceholder="Theo ma, ten, SDT"
          searchValue={search}
          onSearchChange={setSearch}
          onExport={{
            excel: () => handleExport("excel"),
            csv: () => handleExport("csv"),
          }}
          actions={[
            {
              label: "Tao moi",
              icon: <Plus className="h-4 w-4" />,
              variant: "default",
              onClick: () => setCreateOpen(true),
            },
            { label: "Import", icon: <Upload className="h-4 w-4" /> },
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
          selectable
          summaryRow={{
            currentDebt: formatCurrency(totalDebt),
            totalSales: formatCurrency(totalSales),
            totalSalesMinusReturns: formatCurrency(totalSalesMinusReturns),
          }}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={renderDetail}
          getRowId={(row) => row.id}
          rowActions={(row) => [
            {
              label: "Sua",
              icon: <Pencil className="h-4 w-4" />,
              onClick: () => {},
            },
            {
              label: "Xoa",
              icon: <Trash2 className="h-4 w-4" />,
              onClick: () => {},
              variant: "destructive",
              separator: true,
            },
          ]}
        />
      </ListPageLayout>

      <CreateCustomerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
      />
    </>
  );
}
