"use client";

/**
 * Sơ đồ bàn — 1 trang duy nhất, phân quyền bên trong.
 *
 * Quyền:
 *   - floor_plan.edit_global → dropdown chọn mọi chi nhánh
 *   - floor_plan.edit_branch → khoá vào chi nhánh đang chọn ở header
 *   - cả 2 đều không có  → "Không có quyền truy cập"
 */

import { useEffect, useState } from "react";
import { FloorPlanEditor } from "@/components/shared/floor-plan/floor-plan-editor";
import { getBranches, type BranchDetail } from "@/lib/services";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth, useToast } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions";
import { Icon } from "@/components/ui/icon";

export default function SoDoBanPage() {
  const { currentBranch } = useAuth();
  const { toast } = useToast();
  const { hasPermission, isLoading: isAuthLoading } = usePermissions();
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [loaded, setLoaded] = useState(false);

  const canEditGlobal = hasPermission("floor_plan.edit_global");
  const canEditBranch = hasPermission("floor_plan.edit_branch");
  const canEdit = canEditGlobal || canEditBranch;

  // Load chi nhánh — global thấy hết, branch chỉ thấy chi nhánh của họ
  useEffect(() => {
    if (isAuthLoading || !canEdit) return;
    getBranches()
      .then((bs) => {
        const stores = bs.filter((b) => b.branchType === "store");
        // Nếu chỉ có edit_branch → lọc về branch đang chọn
        const visible = canEditGlobal
          ? stores
          : stores.filter((b) => b.id === currentBranch?.id);
        setBranches(visible);
        // Mặc định chọn branch hiện tại nếu có, không thì branch đầu
        const def =
          visible.find((b) => b.id === currentBranch?.id)?.id ??
          visible[0]?.id ??
          "";
        setSelectedBranchId(def);
        setLoaded(true);
      })
      .catch((err) =>
        toast({
          title: "Không tải được chi nhánh",
          description: (err as Error).message,
          variant: "error",
        }),
      );
  }, [
    isAuthLoading,
    canEdit,
    canEditGlobal,
    currentBranch?.id,
    toast,
  ]);

  // Auth đã xong + không có quyền nào → chặn
  if (!isAuthLoading && !canEdit) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Icon name="gpp_bad" size={40} className="text-muted-foreground" />
        <p className="text-lg font-medium text-muted-foreground">
          Không có quyền truy cập
        </p>
        <p className="text-sm text-muted-foreground">
          Cần quyền sơ đồ bàn. Liên hệ quản trị viên.
        </p>
      </div>
    );
  }

  const selectedBranch = branches.find((b) => b.id === selectedBranchId);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] p-4 gap-3">
      {/* Header — chọn chi nhánh */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold">Sơ đồ bàn</h1>
        <Select
          value={selectedBranchId}
          onValueChange={(v) => setSelectedBranchId(v ?? "")}
          disabled={!canEditGlobal || branches.length <= 1}
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
        {!canEditGlobal && (
          <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
            Khoá theo chi nhánh
          </span>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
        {loaded && selectedBranchId ? (
          <FloorPlanEditor
            branchId={selectedBranchId}
            branchName={selectedBranch?.name}
            scope={canEditGlobal ? "global" : "branch"}
          />
        ) : loaded ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Chưa có chi nhánh FnB nào. Tạo chi nhánh trước ở Quản lý chi nhánh.
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Icon name="progress_activity" className="animate-spin" size={20} />
          </div>
        )}
      </div>
    </div>
  );
}
