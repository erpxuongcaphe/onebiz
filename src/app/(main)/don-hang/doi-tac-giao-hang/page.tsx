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
  SelectFilter,
  CheckboxFilter,
  DatePresetFilter,
  RangeFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
} from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getDeliveryPartners, deactivateDeliveryPartner } from "@/lib/services";
import { CreateDeliveryPartnerDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { useToast } from "@/lib/contexts";
import type { DeliveryPartner } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

// --- Status config ---

const statusMap: Record<
  DeliveryPartner["status"],
  { label: string; variant: "default" | "secondary" }
> = {
  active: { label: "Đang hoạt động", variant: "default" },
  inactive: { label: "Ngừng hoạt động", variant: "secondary" },
};

const partnerGroupOptions = [
  { label: "Nhanh", value: "express" },
  { label: "Tiết kiệm", value: "economy" },
  { label: "Nội thành", value: "local" },
];

const statusCheckboxOptions = [
  { label: "Đang hoạt động", value: "active" },
  { label: "Ngừng hoạt động", value: "inactive" },
];

/* ------------------------------------------------------------------ */
/*  Starred set                                                        */
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
/*  Inline detail                                                      */
/* ------------------------------------------------------------------ */
function PartnerDetail({
  partner,
  onClose,
}: {
  partner: DeliveryPartner;
  onClose: () => void;
}) {
  const status = statusMap[partner.status];

  return (
    <InlineDetailPanel open onClose={onClose}>
      <div className="p-4 space-y-4">
        <DetailHeader
          title={partner.name}
          code={partner.id}
          status={{
            label: status.label,
            variant: status.variant,
            className:
              status.variant === "default"
                ? "bg-green-100 text-green-700 border-green-200"
                : undefined,
          }}
          meta={
            <span>
              Ngày tạo: {formatDate(partner.createdAt)}
            </span>
          }
        />
        <DetailTabs
          tabs={[
            {
              id: "info",
              label: "Thông tin",
              content: (
                <DetailInfoGrid
                  columns={2}
                  fields={[
                    { label: "Tên đối tác", value: partner.name },
                    { label: "Điện thoại", value: partner.phone },
                    { label: "Email", value: partner.email || "—" },
                    { label: "Địa chỉ", value: partner.address || "—" },
                    { label: "Trạng thái", value: status.label },
                    { label: "Ngày tạo", value: formatDate(partner.createdAt) },
                  ]}
                />
              ),
            },
            {
              id: "orders",
              label: "Đơn hàng",
              content: (
                <DetailInfoGrid
                  columns={2}
                  fields={[
                    {
                      label: "Đơn đang giao",
                      value: (
                        <span className={partner.activeOrders > 0 ? "text-blue-600 font-medium" : ""}>
                          {String(partner.activeOrders)}
                        </span>
                      ),
                    },
                    {
                      label: "Đơn hoàn thành",
                      value: String(partner.completedOrders),
                    },
                  ]}
                />
              ),
            },
            {
              id: "payment",
              label: "Thanh toán",
              content: (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  Chưa có lịch sử thanh toán
                </div>
              ),
            },
          ]}
          defaultTab="info"
        />
      </div>
    </InlineDetailPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function DoiTacGiaoHangPage() {
  const { toast } = useToast();
  const [data, setData] = useState<DeliveryPartner[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<DeliveryPartner | null>(null);
  const [deactivatingPartner, setDeactivatingPartner] = useState<DeliveryPartner | null>(null);
  const [deactivateLoading, setDeactivateLoading] = useState(false);

  // Stars
  const { starred, toggle: toggleStar } = useStarredSet();

  // Filters
  const [groupFilter, setGroupFilter] = useState("all");
  const [feeFrom, setFeeFrom] = useState("");
  const [feeTo, setFeeTo] = useState("");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("all");
  const [debtFrom, setDebtFrom] = useState("");
  const [debtTo, setDebtTo] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["active", "inactive"]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getDeliveryPartners({
      page,
      pageSize,
      search,
      filters: {
        ...(groupFilter !== "all" && { group: groupFilter }),
        ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, groupFilter, selectedStatuses]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, groupFilter, feeFrom, feeTo, datePreset, debtFrom, debtTo, selectedStatuses]);

  /* ---- Summaries ---- */
  const totalOrders = data.reduce((sum, p) => sum + p.activeOrders + p.completedOrders, 0);

  /* ---- Export ---- */
  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã đối tác", key: "id", width: 15 },
      { header: "Tên đối tác", key: "name", width: 25 },
      { header: "Điện thoại", key: "phone", width: 15 },
      {
        header: "Tổng đơn hàng",
        key: "completedOrders",
        width: 15,
        format: (v: number) => v,
      },
      {
        header: "Trạng thái",
        key: "status",
        width: 15,
        format: (v: DeliveryPartner["status"]) => statusMap[v]?.label ?? v,
      },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "danh-sach-doi-tac-gh");
    else exportToCsv(data, exportColumns, "danh-sach-doi-tac-gh");
  };

  /* ---- Columns ---- */
  const columns: ColumnDef<DeliveryPartner, unknown>[] = [
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
      accessorKey: "id",
      header: "Mã đối tác",
      size: 120,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.id}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "Tên đối tác",
      size: 220,
    },
    {
      accessorKey: "phone",
      header: "Điện thoại",
      size: 130,
    },
    {
      id: "totalOrders",
      header: "Tổng đơn hàng",
      size: 130,
      cell: ({ row }) => (
        <span>
          {row.original.activeOrders + row.original.completedOrders}
        </span>
      ),
    },
    {
      id: "currentDebt",
      header: "Nợ cần trả hiện tại",
      size: 160,
      cell: () => (
        <span className="text-muted-foreground">{formatCurrency(0)}</span>
      ),
    },
    {
      id: "totalFee",
      header: "Tổng phí giao hàng",
      size: 160,
      cell: () => formatCurrency(0),
    },
  ];

  /* ---- Render ---- */
  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Nhóm ĐTGH">
            <SelectFilter
              options={partnerGroupOptions}
              value={groupFilter}
              onChange={setGroupFilter}
              placeholder="Tất cả"
            />
          </FilterGroup>

          <FilterGroup label="Tổng phí giao hàng">
            <RangeFilter
              fromValue={feeFrom}
              toValue={feeTo}
              onFromChange={setFeeFrom}
              onToChange={setFeeTo}
              fromPlaceholder="Từ"
              toPlaceholder="Đến"
            />
          </FilterGroup>

          <FilterGroup label="Thời gian">
            <DatePresetFilter
              value={datePreset}
              onChange={setDatePreset}
            />
          </FilterGroup>

          <FilterGroup label="Nợ hiện tại">
            <RangeFilter
              fromValue={debtFrom}
              toValue={debtTo}
              onFromChange={setDebtFrom}
              onToChange={setDebtTo}
              fromPlaceholder="Từ"
              toPlaceholder="Đến"
            />
          </FilterGroup>

          <FilterGroup label="Trạng thái">
            <CheckboxFilter
              options={statusCheckboxOptions}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Đối tác giao hàng"
        searchPlaceholder="Theo mã, tên đối tác"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
        onImport={() => {}}
        actions={[
          {
            label: "Đối tác giao hàng",
            icon: <Icon name="add" size={16} />,
            variant: "default",
            onClick: () => setCreateOpen(true),
          },
        ]}
      />

      <CreateDeliveryPartnerDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setEditingPartner(null);
        }}
        onSuccess={fetchData}
        initialData={editingPartner ?? undefined}
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
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={(partner, onClose) => (
          <PartnerDetail partner={partner} onClose={onClose} />
        )}
        getRowId={(row) => row.id}
        rowActions={(row) => [
          {
            label: "Sửa",
            icon: <Icon name="edit" size={16} />,
            onClick: () => {
              setEditingPartner(row);
              setCreateOpen(true);
            },
          },
          {
            label: "Ngừng hoạt động",
            icon: <Icon name="block" size={16} />,
            onClick: () => setDeactivatingPartner(row),
            variant: "destructive",
            separator: true,
          },
        ]}
      />

      <ConfirmDialog
        open={!!deactivatingPartner}
        onOpenChange={(open) => { if (!open) setDeactivatingPartner(null); }}
        title="Ngừng hoạt động đối tác"
        description={`Ngừng hoạt động đối tác ${deactivatingPartner?.name ?? ""}?`}
        confirmLabel="Ngừng hoạt động"
        cancelLabel="Đóng"
        variant="destructive"
        loading={deactivateLoading}
        onConfirm={async () => {
          if (!deactivatingPartner) return;
          setDeactivateLoading(true);
          try {
            await deactivateDeliveryPartner(deactivatingPartner.id);
            toast({
              title: "Đã ngừng hoạt động",
              description: `Đối tác ${deactivatingPartner.name} đã được ngừng hoạt động`,
              variant: "success",
            });
            setDeactivatingPartner(null);
            fetchData();
          } catch (err) {
            toast({
              title: "Lỗi ngừng hoạt động",
              description: err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
          } finally {
            setDeactivateLoading(false);
          }
        }}
      />
    </ListPageLayout>
  );
}
