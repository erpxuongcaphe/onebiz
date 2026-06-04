"use client";

/**
 * Sơ đồ bàn — trang chỉnh sửa cấp toàn hệ thống.
 * Admin chọn chi nhánh bất kỳ và sửa sơ đồ.
 */

import { useState, useEffect } from "react";
import { PermissionPage } from "@/components/shared/permission-page";
import { FloorPlanEditor } from "@/components/shared/floor-plan/floor-plan-editor";
import { getBranches, type BranchDetail } from "@/lib/services";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/lib/contexts";

function SoDoBanPageInner() {
  const { toast } = useToast();
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");

  useEffect(() => {
    getBranches()
      .then((bs) => {
        // Chỉ chi nhánh có POS FnB (store) — sơ đồ bàn dành cho quán FnB.
        const stores = bs.filter((b) => b.branchType === "store");
        setBranches(stores);
        if (stores.length > 0) setSelectedBranchId(stores[0].id);
      })
      .catch((err) =>
        toast({
          title: "Không tải được chi nhánh",
          description: (err as Error).message,
          variant: "error",
        }),
      );
  }, [toast]);

  const selectedBranch = branches.find((b) => b.id === selectedBranchId);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] p-4 gap-3">
      {/* Header — chọn chi nhánh */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold">Sơ đồ bàn (toàn hệ thống)</h1>
        <Select
          value={selectedBranchId}
          onValueChange={(v) => setSelectedBranchId(v ?? "")}
          items={branches.map((b) => ({ value: b.id, label: b.name }))}
        >
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Chọn chi nhánh">
              {(v) => branches.find((b) => b.id === v)?.name ?? ""}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Sửa sơ đồ cho mọi chi nhánh. Cashier mọi máy sẽ thấy thay đổi tức thì.
        </p>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
        {selectedBranchId ? (
          <FloorPlanEditor
            branchId={selectedBranchId}
            branchName={selectedBranch?.name}
            scope="global"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Chưa có chi nhánh FnB nào. Tạo chi nhánh trước ở Quản lý chi nhánh.
          </div>
        )}
      </div>
    </div>
  );
}

export default function SoDoBanPage() {
  return (
    <PermissionPage requires="floor_plan.edit_global">
      <SoDoBanPageInner />
    </PermissionPage>
  );
}
