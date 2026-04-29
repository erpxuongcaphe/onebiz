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
}

const EMPTY_FORM: BranchFormState = {
  name: "",
  code: "",
  branchType: "store",
  address: "",
  phone: "",
  isDefault: false,
  priceTierId: "",
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
      isDefault: branch.isDefault,
      priceTierId: branch.priceTierId ?? "",
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
          <Icon name="add" size={16} className="mr-1.5" />
          Thêm chi nhánh
        </Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Đang hoạt động"
          value={activeCount.toString()}
          icon={<Icon name="apartment" size={14} />}
        />
        <SummaryCard
          label="Cửa hàng"
          value={storeCount.toString()}
          icon={<Icon name="storefront" size={14} />}
        />
        <SummaryCard
          label="Kho"
          value={warehouseCount.toString()}
          icon={<Icon name="warehouse" size={14} />}
        />
        <SummaryCard
          label="Xưởng"
          value={factoryCount.toString()}
          icon={<Icon name="factory" size={14} />}
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
                    <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-surface-container-low cursor-pointer outline-none">
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Sửa chi nhánh" : "Thêm chi nhánh"}
            </DialogTitle>
            <DialogDescription>
              Chi nhánh là đơn vị P&amp;L độc lập. Mỗi loại (cửa hàng / kho /
              xưởng) có flow riêng trong POS + kho.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
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
              <div className="space-y-1.5">
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
              <div className="space-y-1.5">
                <Label htmlFor="branch-type">Loại</Label>
                <Select
                  value={form.branchType}
                  onValueChange={(val) =>
                    setForm((f) => ({ ...f, branchType: val as BranchType }))
                  }
                >
                  <SelectTrigger id="branch-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="store">Cửa hàng (POS FnB / Retail)</SelectItem>
                    <SelectItem value="warehouse">Kho tổng (bán sỉ)</SelectItem>
                    <SelectItem value="factory">Xưởng sản xuất</SelectItem>
                    <SelectItem value="office">Văn phòng</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="branch-address">Địa chỉ</Label>
                <Input
                  id="branch-address"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Số nhà, đường, phường, quận, thành phố"
                />
              </div>
              <div className="space-y-1.5">
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
              <div className="space-y-1.5 flex items-end">
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

              {/* Bảng giá mặc định cho POS FnB của chi nhánh — chỉ hiện cho
                  store + warehouse (factory/office không POS bán hàng). */}
              {(form.branchType === "store" || form.branchType === "warehouse") && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="branch-tier">
                    Bảng giá mặc định{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      (POS FnB của chi nhánh)
                    </span>
                  </Label>
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
                    <SelectTrigger id="branch-tier">
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
                  <p className="text-xs text-muted-foreground">
                    Chi nhánh dùng bảng giá này khi check out POS FnB. SP không
                    có trong bảng giá → tự động dùng giá niêm yết.
                  </p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
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
