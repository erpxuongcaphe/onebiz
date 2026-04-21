"use client";

/**
 * Table & Zone Management Page
 *
 * Admin can create/edit/delete zones and tables per branch.
 * Each branch has its own layout. Tables are grouped by zone.
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth, useBranchFilter, useToast } from "@/lib/contexts";
import { ConfirmDialog } from "@/components/shared/dialogs/confirm-dialog";
import { PosBranchSelector } from "@/components/shared/pos-branch-selector";
import {
  getTablesByBranch,
  createTable,
  updateTable,
  deleteTable,
  bulkCreateTables,
  renameZone,
  deleteZone,
} from "@/lib/services/supabase/fnb-tables";
import type { RestaurantTable } from "@/lib/types/fnb";
import { Icon } from "@/components/ui/icon";

// ── Types ──

interface ZoneGroup {
  name: string;
  tables: RestaurantTable[];
  expanded: boolean;
}

// ── Page ──

export default function QuanLyBanPage() {
  const { tenant } = useAuth();
  const { activeBranchId } = useBranchFilter();
  const { toast } = useToast();

  const [zones, setZones] = useState<ZoneGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialogs
  const [addZoneOpen, setAddZoneOpen] = useState(false);
  const [addTableOpen, setAddTableOpen] = useState(false);
  const [editTableOpen, setEditTableOpen] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [renameZoneOpen, setRenameZoneOpen] = useState(false);

  // Form state
  const [newZoneName, setNewZoneName] = useState("");
  const [targetZone, setTargetZone] = useState("");
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [tableForm, setTableForm] = useState({
    name: "",
    tableNumber: 1,
    capacity: 4,
    zone: "",
  });
  const [bulkForm, setBulkForm] = useState({
    zone: "",
    count: 4,
    startNumber: 1,
    capacity: 4,
  });
  const [renameForm, setRenameForm] = useState({ oldZone: "", newZone: "" });

  // Confirm delete state cho Zone + Table
  const [deletingTable, setDeletingTable] = useState<RestaurantTable | null>(null);
  const [deletingZone, setDeletingZone] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const tenantId = tenant?.id ?? "";

  // ── Load tables ──

  const loadTables = useCallback(async () => {
    if (!activeBranchId) return;
    setLoading(true);
    try {
      const tables = await getTablesByBranch(activeBranchId);
      // Group by zone
      const map = new Map<string, RestaurantTable[]>();
      for (const t of tables) {
        const zone = t.zone || "Chưa phân khu";
        if (!map.has(zone)) map.set(zone, []);
        map.get(zone)!.push(t);
      }
      // Sort tables within zone
      for (const arr of map.values()) {
        arr.sort((a, b) => a.sortOrder - b.sortOrder || a.tableNumber - b.tableNumber);
      }
      setZones(
        Array.from(map.entries()).map(([name, tables]) => ({
          name,
          tables,
          expanded: true,
        }))
      );
    } catch {
      toast({ title: "Lỗi", description: "Không tải được danh sách bàn", variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [activeBranchId, toast]);

  useEffect(() => { loadTables(); }, [loadTables]);

  // ── Stats ──

  const totalTables = zones.reduce((s, z) => s + z.tables.length, 0);
  const totalCapacity = zones.reduce(
    (s, z) => s + z.tables.reduce((c, t) => c + t.capacity, 0),
    0
  );

  // ── Handlers ──

  const handleAddZone = async () => {
    if (!newZoneName.trim()) return;
    if (!activeBranchId) return;
    // Create 1 placeholder table in this zone
    try {
      const nextNum = zones.reduce(
        (max, z) => Math.max(max, ...z.tables.map((t) => t.tableNumber)),
        0
      ) + 1;
      await createTable({
        tenantId,
        branchId: activeBranchId,
        tableNumber: nextNum,
        name: `Bàn ${nextNum}`,
        zone: newZoneName.trim(),
        capacity: 4,
      });
      toast({ title: "Thành công", description: `Đã tạo khu vực "${newZoneName}"` });
      setNewZoneName("");
      setAddZoneOpen(false);
      loadTables();
    } catch {
      toast({ title: "Lỗi", description: "Không tạo được khu vực", variant: "error" });
    }
  };

  const handleAddTable = async () => {
    if (!activeBranchId || !tableForm.zone) return;
    try {
      await createTable({
        tenantId,
        branchId: activeBranchId,
        tableNumber: tableForm.tableNumber,
        name: tableForm.name || `Bàn ${tableForm.tableNumber}`,
        zone: tableForm.zone,
        capacity: tableForm.capacity,
      });
      toast({ title: "Thành công", description: `Đã thêm ${tableForm.name || `Bàn ${tableForm.tableNumber}`}` });
      setAddTableOpen(false);
      loadTables();
    } catch {
      toast({ title: "Lỗi", description: "Không thêm được bàn", variant: "error" });
    }
  };

  const handleEditTable = async () => {
    if (!editingTable) return;
    try {
      await updateTable(editingTable.id, {
        name: tableForm.name,
        capacity: tableForm.capacity,
        zone: tableForm.zone || undefined,
      });
      toast({ title: "Đã cập nhật", description: tableForm.name });
      setEditTableOpen(false);
      setEditingTable(null);
      loadTables();
    } catch {
      toast({ title: "Lỗi", description: "Không cập nhật được bàn", variant: "error" });
    }
  };

  // Kiểm tra bàn có khả dụng để xoá không — trước khi mở ConfirmDialog.
  // Nếu không available → toast lỗi ngay, không mở dialog.
  const requestDeleteTable = (table: RestaurantTable) => {
    if (table.status !== "available") {
      toast({ title: "Không thể xoá", description: "Bàn đang có đơn hoặc đang dọn", variant: "error" });
      return;
    }
    setDeletingTable(table);
  };

  const handleDeleteTable = async () => {
    if (!deletingTable) return;
    setDeleteBusy(true);
    try {
      await deleteTable(deletingTable.id);
      toast({ title: "Đã xoá", description: deletingTable.name });
      setDeletingTable(null);
      loadTables();
    } catch {
      toast({ title: "Lỗi", description: "Không xoá được bàn", variant: "error" });
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleBulkAdd = async () => {
    if (!activeBranchId || !bulkForm.zone) return;
    try {
      await bulkCreateTables({
        tenantId,
        branchId: activeBranchId,
        zone: bulkForm.zone,
        count: bulkForm.count,
        startNumber: bulkForm.startNumber,
        capacity: bulkForm.capacity,
      });
      toast({ title: "Thành công", description: `Đã tạo ${bulkForm.count} bàn tại "${bulkForm.zone}"` });
      setBulkAddOpen(false);
      loadTables();
    } catch {
      toast({ title: "Lỗi", description: "Không tạo được bàn", variant: "error" });
    }
  };

  const handleRenameZone = async () => {
    if (!activeBranchId || !renameForm.newZone.trim()) return;
    try {
      await renameZone(activeBranchId, renameForm.oldZone, renameForm.newZone.trim());
      toast({ title: "Đã đổi tên", description: `"${renameForm.oldZone}" → "${renameForm.newZone}"` });
      setRenameZoneOpen(false);
      loadTables();
    } catch {
      toast({ title: "Lỗi", description: "Không đổi tên được", variant: "error" });
    }
  };

  // Kiểm tra khu vực còn bàn đang sử dụng không — trước khi mở ConfirmDialog.
  const requestDeleteZone = (zoneName: string) => {
    if (!activeBranchId) return;
    const zone = zones.find((z) => z.name === zoneName);
    if (zone?.tables.some((t) => t.status !== "available")) {
      toast({ title: "Không thể xoá", description: "Khu vực còn bàn đang sử dụng", variant: "error" });
      return;
    }
    setDeletingZone(zoneName);
  };

  const handleDeleteZone = async () => {
    if (!activeBranchId || !deletingZone) return;
    setDeleteBusy(true);
    try {
      await deleteZone(activeBranchId, deletingZone);
      toast({ title: "Đã xoá khu vực", description: deletingZone });
      setDeletingZone(null);
      loadTables();
    } catch {
      toast({ title: "Lỗi", description: "Không xoá được khu vực", variant: "error" });
    } finally {
      setDeleteBusy(false);
    }
  };

  const toggleZone = (zoneName: string) => {
    setZones((prev) =>
      prev.map((z) => (z.name === zoneName ? { ...z, expanded: !z.expanded } : z))
    );
  };

  const openEditTable = (table: RestaurantTable) => {
    setEditingTable(table);
    setTableForm({
      name: table.name,
      tableNumber: table.tableNumber,
      capacity: table.capacity,
      zone: table.zone || "",
    });
    setEditTableOpen(true);
  };

  const openAddTable = (zone: string) => {
    const zoneGroup = zones.find((z) => z.name === zone);
    const maxNum = zoneGroup
      ? Math.max(0, ...zoneGroup.tables.map((t) => t.tableNumber))
      : 0;
    setTableForm({
      name: "",
      tableNumber: maxNum + 1,
      capacity: 4,
      zone,
    });
    setAddTableOpen(true);
  };

  // ── Branch guard ──

  if (!activeBranchId) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Quản lý Bàn & Khu vực</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Chọn chi nhánh để quản lý bàn
            </p>
          </div>
          <PosBranchSelector variant="light" />
        </div>
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <Icon name="chair" size={40} className="text-muted-foreground" />
          <p className="text-muted-foreground">Chọn chi nhánh ở góc phải để bắt đầu</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon name="progress_activity" className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Quản lý Bàn & Khu vực</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Thiết lập khu vực và sơ đồ bàn cho chi nhánh
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setAddZoneOpen(true)}>
            <Icon name="add" className="size-4 mr-1.5" /> Thêm khu vực
          </Button>
          <Button onClick={() => {
            setBulkForm({
              zone: zones[0]?.name || "",
              count: 4,
              startNumber: totalTables + 1,
              capacity: 4,
            });
            setBulkAddOpen(true);
          }}>
            <Icon name="grid_view" className="size-4 mr-1.5" /> Tạo hàng loạt
          </Button>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-0">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary-fixed">
                <Icon name="grid_view" className="size-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{zones.length}</p>
                <p className="text-xs text-muted-foreground">Khu vực</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-0">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-status-success/10">
                <Icon name="chair" className="size-5 text-status-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalTables}</p>
                <p className="text-xs text-muted-foreground">Tổng bàn</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-0">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-status-info/10">
                <Icon name="group" className="size-5 text-status-info" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalCapacity}</p>
                <p className="text-xs text-muted-foreground">Tổng chỗ ngồi</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Zone sections ── */}
      {zones.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Icon name="chair" className="size-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-lg font-medium text-muted-foreground">Chưa có khu vực nào</p>
            <p className="text-sm text-muted-foreground mt-1">
              Bấm &quot;Thêm khu vực&quot; hoặc &quot;Tạo hàng loạt&quot; để bắt đầu
            </p>
          </CardContent>
        </Card>
      )}

      {zones.map((zone) => (
        <Card key={zone.name}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="flex items-center gap-2 hover:opacity-70 transition-opacity"
                onClick={() => toggleZone(zone.name)}
              >
                {zone.expanded ? (
                  <Icon name="expand_more" className="size-4 text-muted-foreground" />
                ) : (
                  <Icon name="chevron_right" className="size-4 text-muted-foreground" />
                )}
                <CardTitle className="text-base">{zone.name}</CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {zone.tables.length} bàn
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {zone.tables.reduce((s, t) => s + t.capacity, 0)} chỗ
                </Badge>
              </button>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => openAddTable(zone.name)}
                >
                  <Icon name="add" className="size-3.5 mr-1" /> Thêm bàn
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground"
                  onClick={() => {
                    setRenameForm({ oldZone: zone.name, newZone: zone.name });
                    setRenameZoneOpen(true);
                  }}
                >
                  <Icon name="edit" className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-status-error hover:text-status-error hover:bg-status-error/10"
                  onClick={() => requestDeleteZone(zone.name)}
                >
                  <Icon name="delete" className="size-3.5" />
                </Button>
              </div>
            </div>
          </CardHeader>

          {zone.expanded && (
            <CardContent className="pt-0">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                {zone.tables.map((table) => (
                  <div
                    key={table.id}
                    className={cn(
                      "relative group rounded-lg border-2 p-3 flex flex-col items-center gap-1 transition-all",
                      table.status === "available"
                        ? "border-status-success/25 bg-status-success/10"
                        : table.status === "occupied"
                          ? "border-status-error/25 bg-status-error/10"
                          : table.status === "reserved"
                            ? "border-status-warning/25 bg-status-warning/10"
                            : "border-border bg-surface-container-low"
                    )}
                  >
                    {/* Grip handle (visual) */}
                    <Icon name="drag_indicator" className="absolute top-1 left-1 size-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />

                    {/* Table number */}
                    <span className="text-lg font-bold text-foreground">
                      {table.tableNumber}
                    </span>

                    {/* Name */}
                    <span className="text-[10px] text-muted-foreground truncate max-w-full">
                      {table.name}
                    </span>

                    {/* Capacity */}
                    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Icon name="group" className="size-2.5" />
                      {table.capacity} chỗ
                    </span>

                    {/* Status badge */}
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] mt-0.5",
                        table.status === "available" && "text-status-success border-status-success/25",
                        table.status === "occupied" && "text-status-error border-status-error/25",
                        table.status === "reserved" && "text-status-warning border-status-warning/25",
                        table.status === "cleaning" && "text-muted-foreground border-border"
                      )}
                    >
                      {table.status === "available"
                        ? "Trống"
                        : table.status === "occupied"
                          ? "Đang dùng"
                          : table.status === "reserved"
                            ? "Đặt trước"
                            : "Dọn dẹp"}
                    </Badge>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-white/80 text-muted-foreground hover:text-primary"
                        onClick={() => openEditTable(table)}
                        title="Sửa"
                      >
                        <Icon name="edit" className="size-3" />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-white/80 text-muted-foreground hover:text-status-error"
                        onClick={() => requestDeleteTable(table)}
                        title="Xóa"
                      >
                        <Icon name="delete" className="size-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      ))}

      {/* ══════════════════════════ DIALOGS ══════════════════════════ */}

      {/* Add Zone Dialog */}
      <Dialog open={addZoneOpen} onOpenChange={setAddZoneOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm khu vực mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tên khu vực</Label>
              <Input
                placeholder="Tầng 1, Ngoài trời, VIP..."
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddZone()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddZoneOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleAddZone} disabled={!newZoneName.trim()}>
              Tạo khu vực
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Table Dialog */}
      <Dialog open={addTableOpen} onOpenChange={setAddTableOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm bàn — {tableForm.zone}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Số bàn</Label>
                <Input
                  type="number"
                  min={1}
                  value={tableForm.tableNumber}
                  onChange={(e) => setTableForm((f) => ({ ...f, tableNumber: +e.target.value }))}
                />
              </div>
              <div>
                <Label>Số chỗ ngồi</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={tableForm.capacity}
                  onChange={(e) => setTableForm((f) => ({ ...f, capacity: +e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Tên bàn</Label>
              <Input
                placeholder={`Bàn ${tableForm.tableNumber}`}
                value={tableForm.name}
                onChange={(e) => setTableForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTableOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleAddTable}>Thêm bàn</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Table Dialog */}
      <Dialog open={editTableOpen} onOpenChange={setEditTableOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sửa bàn</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tên bàn</Label>
              <Input
                value={tableForm.name}
                onChange={(e) => setTableForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Số chỗ ngồi</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={tableForm.capacity}
                  onChange={(e) => setTableForm((f) => ({ ...f, capacity: +e.target.value }))}
                />
              </div>
              <div>
                <Label>Khu vực</Label>
                <Select
                  value={tableForm.zone}
                  onValueChange={(v) => setTableForm((f) => ({ ...f, zone: v ?? "" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map((z) => (
                      <SelectItem key={z.name} value={z.name}>
                        {z.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTableOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleEditTable}>Lưu</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Add Dialog */}
      <Dialog open={bulkAddOpen} onOpenChange={setBulkAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo bàn hàng loạt</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Khu vực</Label>
              <Input
                placeholder="Tầng 1"
                value={bulkForm.zone}
                onChange={(e) => setBulkForm((f) => ({ ...f, zone: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Số lượng</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={bulkForm.count}
                  onChange={(e) => setBulkForm((f) => ({ ...f, count: +e.target.value }))}
                />
              </div>
              <div>
                <Label>Bắt đầu từ #</Label>
                <Input
                  type="number"
                  min={1}
                  value={bulkForm.startNumber}
                  onChange={(e) => setBulkForm((f) => ({ ...f, startNumber: +e.target.value }))}
                />
              </div>
              <div>
                <Label>Chỗ ngồi/bàn</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={bulkForm.capacity}
                  onChange={(e) => setBulkForm((f) => ({ ...f, capacity: +e.target.value }))}
                />
              </div>
            </div>
            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              Sẽ tạo {bulkForm.count} bàn: Bàn {bulkForm.startNumber} → Bàn{" "}
              {bulkForm.startNumber + bulkForm.count - 1}, mỗi bàn {bulkForm.capacity} chỗ,
              thuộc khu vực &quot;{bulkForm.zone || "..."}&quot;
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAddOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleBulkAdd} disabled={!bulkForm.zone}>
              Tạo {bulkForm.count} bàn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Zone Dialog */}
      <Dialog open={renameZoneOpen} onOpenChange={setRenameZoneOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Đổi tên khu vực</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tên hiện tại</Label>
              <Input value={renameForm.oldZone} disabled />
            </div>
            <div>
              <Label>Tên mới</Label>
              <Input
                value={renameForm.newZone}
                onChange={(e) => setRenameForm((f) => ({ ...f, newZone: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && handleRenameZone()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameZoneOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleRenameZone} disabled={!renameForm.newZone.trim()}>
              Đổi tên
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm xoá bàn / khu vực — không cho lỡ tay xoá config layout quán */}
      <ConfirmDialog
        open={deletingTable !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingTable(null);
        }}
        title="Xoá bàn?"
        description={
          deletingTable
            ? `Xoá bàn "${deletingTable.name}" khỏi chi nhánh này. Thao tác không thể hoàn tác.`
            : ""
        }
        confirmLabel="Xoá bàn"
        cancelLabel="Đóng"
        variant="destructive"
        loading={deleteBusy}
        onConfirm={handleDeleteTable}
      />

      <ConfirmDialog
        open={deletingZone !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingZone(null);
        }}
        title="Xoá khu vực?"
        description={
          deletingZone
            ? `Xoá khu vực "${deletingZone}". Các bàn thuộc khu vực sẽ chuyển sang "Chưa phân khu". Thao tác không thể hoàn tác.`
            : ""
        }
        confirmLabel="Xoá khu vực"
        cancelLabel="Đóng"
        variant="destructive"
        loading={deleteBusy}
        onConfirm={handleDeleteZone}
      />
    </div>
  );
}
