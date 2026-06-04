"use client";

/**
 * Sơ đồ bàn — trang chỉnh sửa cho quản lý từng chi nhánh.
 * Dùng currentBranch (chi nhánh đang chọn ở header).
 */

import { PermissionPage } from "@/components/shared/permission-page";
import { FloorPlanEditor } from "@/components/shared/floor-plan/floor-plan-editor";
import { useAuth } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";

function SoDoBanBranchInner() {
  const { currentBranch } = useAuth();

  if (!currentBranch) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] gap-2 text-muted-foreground">
        <Icon name="map" size={40} className="opacity-40" />
        <p className="text-sm">Chọn chi nhánh ở header trước.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] p-4 gap-3">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold">Sơ đồ bàn — {currentBranch.name}</h1>
      </div>
      <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
        <FloorPlanEditor
          branchId={currentBranch.id}
          branchName={currentBranch.name}
          scope="branch"
        />
      </div>
    </div>
  );
}

export default function SoDoBanBranchPage() {
  return (
    <PermissionPage requires="floor_plan.edit_branch">
      <SoDoBanBranchInner />
    </PermissionPage>
  );
}
