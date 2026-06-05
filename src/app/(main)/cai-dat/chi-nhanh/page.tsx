"use client";

/**
 * Quản lý chi nhánh — CRUD thật cho tất cả chi nhánh của tenant.
 *
 * Chi nhánh là đơn vị profit center độc lập. Mỗi cửa hàng ERP có:
 *   - store     = quán FnB / cửa hàng bán lẻ (POS FnB / POS Retail)
 *   - warehouse = kho tổng / bán sỉ (POS Retail + inventory)
 *   - factory   = xưởng sản xuất (production orders)
 *   - office    = văn phòng / HQ
 *
 * Trang cũ hardcode 3 chi nhánh HCM/HN/ĐN → CEO không biết mình có branch
 * thật gì. Giờ query `branches` table thật + cho CEO tạo/sửa/ngưng hoạt động.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { SummaryCard } from "@/components/shared/summary-card";
import { useAuth, useToast } from "@/lib/contexts";
import { PermissionPage } from "@/components/shared/permission-page";
import {
  getBranches,
  createBranch,
  updateBranch,
  setBranchDefault,
  BRANCH_TYPE_LABELS,
  getPriceTiers,
  type BranchDetail,
} from "@/lib/services";
import type { PriceTier } from "@/lib/types";

type BranchType = BranchDetail["branchType"];

// Form state cho dialog tạo/sửa.
interface BranchFormState {
  name: string;
  code: string;
  branchType: BranchType;
  address: string;
  phone: string;
  isDefault: boolean;
  /** Bảng giá mặc định cho POS FnB của chi nhánh — empty = giá niêm yết */
  priceTierId: string;
  // Day 20/05/2026 (CEO): thông tin pháp nhân
  legalEntityType: "" | "company" | "household" | "sole_proprietorship" | "individual";
  legalEntityName: string;
  legalTaxCode: string;
  legalRegistrationNo: string;
  // CEO 03/06/2026 — Sprint 3: chế độ tồn kho
  cascadeMode: "production" | "outlet";
  // CEO 05/06/2026 — Sprint 6: giờ chốt ca (0-23, default 3h sáng)
  shiftCutoffHour: number;
}

const EMPTY_FORM: BranchFormState = {
  name: "",
  code: "",
  branchType: "store",
  address: "",
  phone: "",
  isDefault: false,
  priceTierId: "",
  legalEntityType: "",
  legalEntityName: "",
  legalTaxCode: "",
  legalRegistrationNo: "",
  cascadeMode: "outlet",
  shiftCutoffHour: 3,
};

/** Validate VN phone nếu nhập (optional). */
function validateOptionalVnPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s-]/g, "");
  if (!cleaned) return true; // optional
  if (/^0\d{9,10}$/.test(cleaned)) return true;
  if (/^(\+?84)\d{9,10}$/.test(cleaned)) return true;
  return false;
}

/** Màu badge theo loại chi nhánh. */
function getBranchTypeBadgeVariant(type: BranchType) {
  switch (type) {
    case "store":
      return "default" as const;
    case "warehouse":
      return "secondary" as const;
    case "factory":
      return "outline" as const;
    case "office":
      return "outline" as const;
  }
}

function BranchSettingsPageInner() {
  const { tenant, refreshProfile } = useAuth();
  const { toast } = useToast();
  const tenantId = tenant?.id ?? "";

  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog create/edit
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BranchFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Action confirm
  const [confirmDeactivate, setConfirmDeactivate] = useState<BranchDetail | null>(null);
  const [confirmSetDefault, setConfirmSetDefault] = useState<BranchDetail | null>(null);

  // Tier list cho dropdown "Bảng giá mặc định" — chỉ load khi mở dialog
  const [tiers, setTiers] = useState<PriceTier[]>([]);
  useEffect(() => {
    if (!dialogOpen) return;
    let cancelled = false;
    // Chi nhánh là FnB scope → chỉ lấy tier scope=fnb HOẶC both
    getPriceTiers({ scope: "fnb" })
      .then((list) => {
        if (!cancelled) setTiers(list);
      })
      .catch(() => {
        // fail silent — tier optional
      });
    return () => {
      cancelled = true;
    };
  }, [dialogOpen]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getBranches();
      setBranches(rows);
    } catch (err) {
      toast({
        title: "Không tải được danh sách chi nhánh",
        description: (err as Error).message,
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreateDialog = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEditDialog = (branch: BranchDetail) => {
    setEditingId(branch.id);
    setForm({
      name: branch.name,
      code: branch.code ?? "",
      branchType: branch.branchType,
      address: branch.address ?? "",
      phone: branch.phone ?? "",
      // Day 20/05/2026 (CEO): pháp nhân
      legalEntityType: branch.legalEntityType ?? "",
      legalEntityName: branch.legalEntityName ?? "",
      legalTaxCode: branch.legalTaxCode ?? "",
      legalRegistrationNo: branch.legalRegistrationNo ?? "",
      isDefault: branch.isDefault,
      priceTierId: branch.priceTierId ?? "",
      // CEO 03/06/2026 — Sprint 3: prefill cascadeMode khi edit
      cascadeMode: branch.cascadeMode ?? "outlet",
      // CEO 05/06/2026: prefill shift_cutoff_hour
      shiftCutoffHour: branch.shiftCutoffHour ?? 3,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    // Validate
    if (!form.name.trim()) {
      toast({
        title: "Thiếu tên chi nhánh",
        description: "Nhập tên để lưu.",
        variant: "error",
      });
      return;
    }
    if (!validateOptionalVnPhone(form.phone)) {
      toast({
        title: "SĐT không hợp lệ",
        description: "Nhập đúng định dạng VN hoặc để trống.",
        variant: "error",
      });
      return;
    }

    if (!tenantId) {
      toast({
        title: "Chưa sẵn sàng",
        description: "Tenant chưa load. Thử lại sau.",
        variant: "error",
      });
      return;
    }

    setSaving(true);
    try {
      const phoneCleaned = form.phone.replace(/[\s-]/g, "");
      if (editingId) {
        await updateBranch(editingId, {
          name: form.name.trim(),
          code: form.code.trim(),
          branchType: form.branchType,
          address: form.address.trim(),
          phone: phoneCleaned,
          // null nếu user xoá → clear tier (về giá niêm yết)
          priceTierId: form.priceTierId || null,
          // Day 20/05/2026 (CEO): pháp nhân
          legalEntityType: form.legalEntityType || null,
          legalEntityName: form.legalEntityName.trim() || null,
          legalTaxCode: form.legalTaxCode.trim() || null,
          legalRegistrationNo: form.legalRegistrationNo.trim() || null,
          // CEO 03/06/2026 — Sprint 3: cascade mode
          cascadeMode: form.cascadeMode,
          // CEO 05/06/2026: giờ chốt ca
          shiftCutoffHour: form.shiftCutoffHour,
        });
        // Nếu bật isDefault (và chi nhánh chưa phải default) → set lại
        const current = branches.find((b) => b.id === editingId);
        if (form.isDefault && current && !current.isDefault) {
          await setBranchDefault(editingId, tenantId);
        }
        toast({
          title: "Đã cập nhật",
          description: `Chi nhánh "${form.name}" đã lưu.`,
          variant: "success",
        });
      } else {
        await createBranch({
          tenantId,
          name: form.name.trim(),
          code: form.code.trim() || undefined,
          branchType: form.branchType,
          address: form.address.trim() || undefined,
          phone: phoneCleaned || undefined,
          isDefault: form.isDefault,
          // CEO 13/05: fix bug — pass priceTierId xuống service
          priceTierId: form.priceTierId || null,
          // Day 20/05/2026 (CEO): pháp nhân
          legalEntityType: form.legalEntityType || null,
          legalEntityName: form.legalEntityName.trim() || null,
          legalTaxCode: form.legalTaxCode.trim() || null,
          legalRegistrationNo: form.legalRegistrationNo.trim() || null,
          // CEO 03/06/2026 — Sprint 3: cascade mode
          cascadeMode: form.cascadeMode,
          // CEO 05/06/2026: giờ chốt ca
          shiftCutoffHour: form.shiftCutoffHour,
        });
        toast({
          title: "Đã thêm chi nhánh",
          description: `"${form.name}" đã được tạo.`,
          variant: "success",
        });
      }
      setDialogOpen(false);
      await load();
      // Refresh auth context để top-nav + POS thấy branch mới ngay.
      await refreshProfile();
    } catch (err) {
      toast({
        title: "Lưu không thành công",
        description: (err as Error).message,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!confirmDeactivate) return;
    try {
      await updateBranch(confirmDeactivate.id, { isActive: false });
      toast({
        title: "Đã ngưng hoạt động",
        description: `"${confirmDeactivate.name}" không còn xuất hiện trong chọn chi nhánh.`,
        variant: "success",
      });
      setConfirmDeactivate(null);
      await load();
      await refreshProfile();
    } catch (err) {
      toast({
        title: "Không ngưng được",
        description: (err as Error).message,
        variant: "error",
      });
    }
  };

  const handleReactivate = async (branch: BranchDetail) => {
    try {
      await updateBranch(branch.id, { isActive: true });
      toast({
        title: "Đã kích hoạt lại",
        description: `"${branch.name}" đã hoạt động trở lại.`,
        variant: "success",
      });
      await load();
      await refreshProfile();
    } catch (err) {
      toast({
        title: "Không kích hoạt được",
        description: (err as Error).message,
        variant: "error",
      });
    }
  };

  const handleSetDefault = async () => {
    if (!confirmSetDefault || !tenantId) return;
    try {
      await setBranchDefault(confirmSetDefault.id, tenantId);
      toast({
        title: "Đã đặt mặc định",
        description: `Chi nhánh "${confirmSetDefault.name}" là mặc định mới.`,
        variant: "success",
      });
      setConfirmSetDefault(null);
      await load();
      await refreshProfile();
    } catch (err) {
      toast({
        title: "Không đặt được",
        description: (err as Error).message,
        variant: "error",
      });
    }
  };

  // Thống kê
  const activeCount = branches.filter((b) => b.isActive).length;
  const storeCount = branches.filter((b) => b.branchType === "store").length;
  const warehouseCount = branches.filter((b) => b.branchType === "warehouse").length;
  const factoryCount = branches.filter((b) => b.branchType === "factory").length;
  const officeCount = branches.filter((b) => b.branchType === "office").length;

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Quản lý chi nhánh</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Quản lý các chi nhánh của {tenant?.name ?? "cửa hàng"}
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Icon name="add" size={16} className="mr-1" />
          Thêm chi nhánh
        </Button>
      </div>

      {/* KPI row — 5 ô: Tổng hoạt động + 4 loại chi nhánh */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard
          label="Đang hoạt động"
          value={activeCount.toString()}
          icon={<Icon name="apartment" size={14} />}
        />
        <SummaryCard
          label="Cửa hàng FnB"
          value={storeCount.toString()}
          icon={<Icon name="storefront" size={14} />}
        />
        <SummaryCard
          label="Kho tổng"
          value={warehouseCount.toString()}
          icon={<Icon name="warehouse" size={14} />}
        />
        <SummaryCard
          label="Xưởng SX"
          value={factoryCount.toString()}
          icon={<Icon name="factory" size={14} />}
        />
        <SummaryCard
          label="Văn phòng"
          value={officeCount.toString()}
          icon={<Icon name="business_center" size={14} />}
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tên chi nhánh</TableHead>
              <TableHead>Loại</TableHead>
              <TableHead className="hidden md:table-cell">Địa chỉ</TableHead>
              <TableHead className="hidden sm:table-cell">SĐT</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Đang tải...
                </TableCell>
              </TableRow>
            )}
            {!loading && branches.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Chưa có chi nhánh nào. Bấm &quot;Thêm chi nhánh&quot; để bắt đầu.
                </TableCell>
              </TableRow>
            )}
            {branches.map((branch) => (
              <TableRow key={branch.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {branch.code && (
                      <span className="text-xs font-mono text-muted-foreground">
                        {branch.code}
                      </span>
                    )}
                    <span>{branch.name}</span>
                    {branch.isDefault && (
                      <Badge variant="outline" className="text-xs">
                        Mặc định
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={getBranchTypeBadgeVariant(branch.branchType)}>
                    {BRANCH_TYPE_LABELS[branch.branchType]}
                  </Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {branch.address || "—"}
                </TableCell>
                <TableCell className="hidden sm:table-cell text-sm">
                  {branch.phone || "—"}
                </TableCell>
                <TableCell>
                  {branch.isActive ? (
                    <Badge variant="default">Hoạt động</Badge>
                  ) : (
                    <Badge variant="secondary">Ngưng</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-lg hover:bg-surface-container-low cursor-pointer outline-none">
                      <Icon name="more_vert" size={16} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={4}>
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onSelect={() => openEditDialog(branch)}
                      >
                        <Icon name="edit" size={14} className="mr-2" />
                        Sửa thông tin
                      </DropdownMenuItem>
                      {branch.isActive && !branch.isDefault && (
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onSelect={() => setConfirmSetDefault(branch)}
                        >
                          <Icon name="star" size={14} className="mr-2" />
                          Đặt làm mặc định
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      {branch.isActive ? (
                        <DropdownMenuItem
                          className="cursor-pointer text-destructive"
                          onSelect={() => setConfirmDeactivate(branch)}
                          disabled={branch.isDefault}
                        >
                          <Icon name="block" size={14} className="mr-2" />
                          Ngưng hoạt động
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onSelect={() => handleReactivate(branch)}
                        >
                          <Icon name="restore" size={14} className="mr-2" />
                          Kích hoạt lại
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        {/* CEO 13/05: dialog 3xl — label dropdown "Cửa hàng" dài + form
            2 cột (Mã + Loại) cần đủ chỗ.
            CEO 20/05/2026: max-h + flex-col + overflow trên div nội dung
            để form scroll được khi dài (có thông tin pháp nhân + bảng giá). */}
        <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>
              {editingId ? "Sửa chi nhánh" : "Thêm chi nhánh"}
            </DialogTitle>
            <DialogDescription>
              Chi nhánh là đơn vị P&amp;L độc lập. Mỗi loại (cửa hàng / kho /
              xưởng) có flow riêng trong POS + kho.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 px-6 overflow-y-auto flex-1 min-h-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="branch-name">
                  Tên chi nhánh <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="branch-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="VD: Quán Cà Phê Quận 1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-code">Mã chi nhánh</Label>
                <Input
                  id="branch-code"
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                  }
                  placeholder="VD: CF01, KHO01, XUONG"
                  maxLength={16}
                />
                <p className="text-xs text-muted-foreground">
                  Hiển thị trên header POS + in hoá đơn.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-type">Loại</Label>
                <Select
                  value={form.branchType}
                  onValueChange={(val) =>
                    setForm((f) => {
                      const nextType = val as BranchType;
                      // CEO 03/06/2026 — Sprint 3: auto-suggest cascade_mode
                      // khi user đổi loại chi nhánh và CHƯA chỉnh tay
                      // cascadeMode (giữ giá trị mặc định cũ của loại trước).
                      const prevDefaultMode =
                        f.branchType === "warehouse" || f.branchType === "factory"
                          ? "production"
                          : "outlet";
                      const isAtPrevDefault = f.cascadeMode === prevDefaultMode;
                      const nextDefaultMode =
                        nextType === "warehouse" || nextType === "factory"
                          ? "production"
                          : "outlet";
                      return {
                        ...f,
                        branchType: nextType,
                        cascadeMode: isAtPrevDefault ? nextDefaultMode : f.cascadeMode,
                      };
                    })
                  }
                  items={[
                    { value: "store", label: "Cửa hàng FnB" },
                    { value: "warehouse", label: "Kho tổng" },
                    { value: "factory", label: "Xưởng SX" },
                    { value: "office", label: "Văn phòng" },
                  ]}
                >
                  {/* CEO 13/05: label ngắn fit cột 2-col. Phân định rõ FnB
                      và Retail là 2 mảng riêng — Cửa hàng FnB ≠ Kho tổng. */}
                  <SelectTrigger id="branch-type" className="w-full">
                    <SelectValue placeholder="Chọn loại">
                      {(v) => {
                        const labels: Record<string, string> = {
                          store: "Cửa hàng FnB",
                          warehouse: "Kho tổng",
                          factory: "Xưởng SX",
                          office: "Văn phòng",
                        };
                        return labels[v as string] ?? "Chọn loại";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="store">Cửa hàng FnB (POS FnB + KDS)</SelectItem>
                    <SelectItem value="warehouse">Kho tổng (POS Retail — bán sỉ)</SelectItem>
                    <SelectItem value="factory">Xưởng sản xuất (rang hạt)</SelectItem>
                    <SelectItem value="office">Văn phòng (ghi nhận chi phí HQ)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {form.branchType === "store" && "Quán bán đồ uống — POS FnB + KDS bếp/bar"}
                  {form.branchType === "warehouse" && "Bán sỉ hạt rang + máy móc — POS Retail"}
                  {form.branchType === "factory" && "Rang hạt cà phê — không POS bán hàng"}
                  {form.branchType === "office" && "Văn phòng HQ — ghi nhận chi phí điều hành (lương, VPP, điện nước)"}
                </p>
              </div>

              {/* CEO 03/06/2026 — Sprint 3: Chế độ tồn kho.
                  Phân biệt Kho/Xưởng sản xuất (cascade BOM trừ NVL gốc) vs
                  Quán/Outlet (trừ tồn SKU trực tiếp). Auto-suggest theo
                  branchType nhưng cho user override. */}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="branch-cascade-mode">
                  Chế độ tồn kho
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    · bán SKU có công thức xử lý thế nào
                  </span>
                </Label>
                <Select
                  value={form.cascadeMode}
                  onValueChange={(val) =>
                    setForm((f) => ({ ...f, cascadeMode: val as "production" | "outlet" }))
                  }
                  items={[
                    { value: "production", label: "🏭 Kho/Xưởng sản xuất" },
                    { value: "outlet", label: "🏪 Quán/Outlet" },
                  ]}
                >
                  <SelectTrigger id="branch-cascade-mode" className="w-full">
                    <SelectValue placeholder="Chọn chế độ">
                      {(v) => {
                        if (v === "production") return "🏭 Kho/Xưởng sản xuất";
                        if (v === "outlet") return "🏪 Quán/Outlet";
                        return "Chọn chế độ";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">
                      🏭 Kho/Xưởng sản xuất — Bán SKU sẽ tự trừ NVL gốc theo công thức (BOM)
                    </SelectItem>
                    <SelectItem value="outlet">
                      🏪 Quán/Outlet — Bán SKU thì trừ tồn SKU đã nhập sẵn, không đụng NVL
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                  {form.cascadeMode === "production" ? (
                    <>
                      <strong>Áp dụng cho Kho tổng / Xưởng rang:</strong> nơi
                      quản lý NVL gốc. Khi bán/xuất nội bộ SKU đóng gói (vd
                      sữa lon, gói cà phê 1kg) → hệ thống tự đọc công thức
                      BOM, trừ NVL gốc tương ứng. SKU đóng gói không cần giữ
                      tồn riêng — tồn thực ở NVL.
                    </>
                  ) : (
                    <>
                      <strong>Áp dụng cho Quán/Cửa hàng:</strong> nơi nhận SKU
                      từ Kho tổng để bán hoặc pha chế. Khi bán SKU → trừ tồn
                      SKU đã nhập trực tiếp (không tìm về NVL gốc, vì NVL gốc
                      không có ở Quán). Món pha chế (Bạc xỉu…) muốn cascade
                      BOM trừ SKU thành phần → tạo BOM riêng cho Quán.
                    </>
                  )}
                </div>
              </div>

              {/* CEO 05/06/2026: Giờ chốt ca — quá giờ này mà ca chưa đóng → auto pending */}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="branch-shift-cutoff">
                  Giờ chốt ca làm việc
                </Label>
                <Select
                  value={String(form.shiftCutoffHour)}
                  onValueChange={(val) =>
                    setForm((f) => ({ ...f, shiftCutoffHour: Number(val) }))
                  }
                >
                  <SelectTrigger id="branch-shift-cutoff">
                    <SelectValue placeholder="Chọn giờ chốt ca" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, h) => (
                      <SelectItem key={h} value={String(h)}>
                        {String(h).padStart(2, "0")}:00
                        {h === 3 && " (mặc định)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                  Nếu nhân viên quên đóng ca, ca sẽ tự chuyển "Chờ đối chiếu"
                  khi qua giờ này. Quản lý phải đếm tiền mặt + ghi lý do để chốt
                  số liệu vào báo cáo.
                  <br />
                  <strong>Gợi ý:</strong> Quán cà phê thường mở 6h-22h → chọn{" "}
                  <strong>03:00</strong> (mặc định). Quán bar/khuya → chọn{" "}
                  <strong>06:00</strong>. Văn phòng/kho → có thể chọn{" "}
                  <strong>00:00</strong> để chốt theo ngày kế toán.
                </div>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="branch-address">Địa chỉ</Label>
                <Input
                  id="branch-address"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Số nhà, đường, phường, quận, thành phố"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-phone">Số điện thoại</Label>
                <Input
                  id="branch-phone"
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="0912345678"
                />
              </div>
              <div className="space-y-2 flex items-end">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none pb-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={form.isDefault}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, isDefault: e.target.checked }))
                    }
                  />
                  <span className="text-sm">Đặt làm mặc định</span>
                </label>
              </div>

              {/* Day 20/05/2026 (CEO): section Thông tin pháp nhân — quản lý
                  chi nhánh theo pháp nhân. Hiển thị trên hoá đơn VAT.
                  CEO feedback 20/05 16:04: bỏ "Loại pháp nhân" + "Số ĐKKD"
                  — gây rối, không cần. Chỉ giữ Tên pháp nhân + MST. */}
              <div className="sm:col-span-2 border-t pt-4 mt-2">
                <div className="flex items-center gap-2 mb-3">
                  <Icon name="business" size={16} className="text-primary" />
                  <h4 className="text-sm font-semibold">
                    Thông tin pháp nhân{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      · tuỳ chọn
                    </span>
                  </h4>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Khai báo pháp nhân của chi nhánh để in hoá đơn VAT + báo cáo
                  thuế. CEO chuỗi có nhiều pháp nhân (công ty, hộ KD) có thể
                  phân định rõ chi nhánh nào thuộc đơn vị nào.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="legal-entity-name">Tên pháp nhân đầy đủ</Label>
                    <Input
                      id="legal-entity-name"
                      value={form.legalEntityName}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          legalEntityName: e.target.value,
                        }))
                      }
                      placeholder='VD: Công ty TNHH ONEBIZ Cà Phê / Hộ kinh doanh Quán Sài Gòn'
                    />
                    <p className="text-xs text-muted-foreground">
                      Tên in trên hoá đơn VAT, hợp đồng. Ghi đầy đủ "Công ty
                      TNHH..." / "Hộ kinh doanh..." / "DNTN...".
                    </p>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="legal-tax-code">Mã số thuế pháp nhân</Label>
                    <Input
                      id="legal-tax-code"
                      value={form.legalTaxCode}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          legalTaxCode: e.target.value,
                        }))
                      }
                      placeholder="VD: 0301234567 hoặc 0301234567-001"
                    />
                  </div>
                </div>
              </div>

              {/* Bảng giá mặc định cho POS FnB / Retail của chi nhánh.
                  Chỉ hiện cho store + warehouse (factory/office không POS bán hàng).
                  CEO 13/05: nếu chưa có tier nào → empty state + CTA tạo bảng giá,
                  không render dropdown chỉ có "Giá niêm yết" vô nghĩa. */}
              {(form.branchType === "store" || form.branchType === "warehouse") && (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="branch-tier">
                    Bảng giá mặc định{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({form.branchType === "store" ? "POS FnB" : "POS Retail"} của chi nhánh)
                    </span>
                  </Label>

                  {tiers.length === 0 ? (
                    // Empty state — chưa có bảng giá nào, hướng dẫn user tạo
                    <div className="rounded-lg border border-dashed border-status-info/30 bg-status-info/5 p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <Icon name="info" size={16} className="text-status-info shrink-0 mt-0.5" />
                        <div className="space-y-1.5">
                          <p className="text-sm font-medium">Chưa có bảng giá nào</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            Bảng giá cho phép áp giá khác nhau theo chi nhánh (VD: quán mặt
                            tiền +20%, quán dân cư giữ giá niêm yết). Hiện chi nhánh sẽ
                            dùng <strong>giá niêm yết</strong> cho mọi sản phẩm.
                          </p>
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Link
                              href="/cai-dat/bang-gia"
                              target="_blank"
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                            >
                              <Icon name="add" size={14} />
                              Tạo bảng giá mới (tab mới)
                            </Link>
                            <span className="text-xs text-muted-foreground">
                              · Sau khi tạo xong, mở lại dialog này để chọn
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Select
                        value={form.priceTierId || "__none__"}
                        onValueChange={(val) =>
                          setForm((f) => ({
                            ...f,
                            priceTierId: !val || val === "__none__" ? "" : val,
                          }))
                        }
                        // items prop để Base UI resolve UUID -> label, tránh hiện UUID
                        // thô khi tier chưa load xong hoặc khi prefill edit mode.
                        items={[
                          {
                            value: "__none__",
                            label: "— Giá niêm yết (không áp tier) —",
                          },
                          ...tiers.map((t) => ({
                            value: t.id,
                            label: t.code ? `${t.name} (${t.code})` : t.name,
                          })),
                        ]}
                      >
                        <SelectTrigger id="branch-tier" className="w-full">
                          <SelectValue placeholder="— Giá niêm yết —">
                            {(v) => {
                              if (!v || v === "__none__") {
                                return "— Giá niêm yết (không áp tier) —";
                              }
                              const match = tiers.find((t) => t.id === v);
                              if (match) {
                                return match.code
                                  ? `${match.name} (${match.code})`
                                  : match.name;
                              }
                              return "— Giá niêm yết —";
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">
                            — Giá niêm yết (không áp tier) —
                          </SelectItem>
                          {tiers.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                              {t.code ? ` (${t.code})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground flex-1">
                          Chi nhánh dùng bảng giá này khi check out. SP không có
                          trong bảng giá → tự động dùng giá niêm yết.
                        </p>
                        <Link
                          href="/cai-dat/bang-gia"
                          target="_blank"
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline shrink-0"
                        >
                          <Icon name="add" size={12} />
                          Tạo bảng giá mới
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="px-6 pb-6 pt-3 border-t shrink-0">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Huỷ
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Đang lưu..." : editingId ? "Cập nhật" : "Thêm chi nhánh"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm deactivate */}
      <Dialog
        open={!!confirmDeactivate}
        onOpenChange={(open) => !open && setConfirmDeactivate(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ngưng hoạt động chi nhánh?</DialogTitle>
            <DialogDescription>
              Chi nhánh &quot;{confirmDeactivate?.name}&quot; sẽ không còn xuất
              hiện trong chọn chi nhánh. Dữ liệu cũ (đơn hàng, tồn kho) vẫn giữ
              nguyên — chỉ ẩn khỏi giao diện. Có thể kích hoạt lại bất kỳ lúc
              nào.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDeactivate(null)}
            >
              Huỷ
            </Button>
            <Button variant="destructive" onClick={handleDeactivate}>
              Ngưng hoạt động
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm set default */}
      <Dialog
        open={!!confirmSetDefault}
        onOpenChange={(open) => !open && setConfirmSetDefault(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Đổi chi nhánh mặc định?</DialogTitle>
            <DialogDescription>
              Chi nhánh &quot;{confirmSetDefault?.name}&quot; sẽ là mặc định cho
              user mới + dashboard khi chưa chọn chi nhánh cụ thể.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmSetDefault(null)}
            >
              Huỷ
            </Button>
            <Button onClick={handleSetDefault}>Xác nhận đặt mặc định</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function BranchSettingsPage() {
  return (
    <PermissionPage requires="system.manage_branches">
      <BranchSettingsPageInner />
    </PermissionPage>
  );
}
