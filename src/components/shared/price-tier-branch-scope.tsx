"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { useToast } from "@/lib/contexts";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { usePermissions } from "@/lib/permissions/use-permission";
import { getBranches, type BranchDetail } from "@/lib/services/supabase/branches";
import {
  getPriceTierBranchAssignments,
  savePriceTierBranchAssignments,
  type BranchPriceTierAssignment,
  type BranchPriceTierAssignmentInput,
} from "@/lib/services/supabase/pricing";
import type { PriceTier } from "@/lib/types";

type AssignmentDraft = BranchPriceTierAssignmentInput;

function toLocalDateTime(value?: string): string {
  const date = value ? new Date(value) : new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIso(value: string): string {
  return new Date(value).toISOString();
}

function formatAssignmentWindow(assignment: BranchPriceTierAssignment): string {
  if (assignment.validityMode === "indefinite") return "Không thời hạn";
  const formatter = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(assignment.startsAt))} - ${formatter.format(new Date(assignment.endsAt!))}`;
}

export function PriceTierBranchScope({ tier }: { tier: PriceTier }) {
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission(PERMISSIONS.PRODUCTS_MANAGE_PRICES);
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [assignments, setAssignments] = useState<BranchPriceTierAssignment[]>([]);
  const [drafts, setDrafts] = useState<AssignmentDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [branchRows, assignmentRows] = await Promise.all([
        getBranches(),
        getPriceTierBranchAssignments(tier.id),
      ]);
      setBranches(branchRows);
      setAssignments(assignmentRows);
    } catch (loadError) {
      toast({
        title: "Chưa tải được phạm vi chi nhánh",
        description:
          loadError instanceof Error ? loadError.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [tier.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const branchById = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch])),
    [branches]
  );

  function openEditor() {
    setDrafts(
      assignments.map((assignment) => ({
        branchId: assignment.branchId,
        validityMode: assignment.validityMode,
        startsAt: toLocalDateTime(assignment.startsAt),
        endsAt: assignment.endsAt
          ? toLocalDateTime(assignment.endsAt)
          : undefined,
      }))
    );
    setError("");
    setOpen(true);
  }

  function toggleBranch(branchId: string, checked: boolean) {
    if (checked) {
      setDrafts((current) => [
        ...current,
        {
          branchId,
          validityMode: "indefinite",
          startsAt: toLocalDateTime(),
        },
      ]);
    } else {
      setDrafts((current) => current.filter((item) => item.branchId !== branchId));
    }
  }

  function updateDraft(
    branchId: string,
    patch: Partial<Omit<AssignmentDraft, "branchId">>
  ) {
    setDrafts((current) =>
      current.map((item) =>
        item.branchId === branchId ? { ...item, ...patch } : item
      )
    );
  }

  async function save() {
    setError("");
    const invalid = drafts.find(
      (draft) =>
        !draft.startsAt ||
        (draft.validityMode === "fixed" &&
          (!draft.endsAt || new Date(draft.endsAt) <= new Date(draft.startsAt)))
    );
    if (invalid) {
      setError("Thời gian kết thúc phải sau thời gian bắt đầu.");
      return;
    }

    setSaving(true);
    try {
      await savePriceTierBranchAssignments({
        priceTierId: tier.id,
        assignments: drafts.map((draft) => ({
          ...draft,
          startsAt: toIso(draft.startsAt),
          endsAt:
            draft.validityMode === "fixed" && draft.endsAt
              ? toIso(draft.endsAt)
              : undefined,
        })),
        reason: "Cập nhật từ workspace Bảng giá",
      });
      await load();
      setOpen(false);
      toast({ title: "Đã lưu phạm vi bảng giá", variant: "success" });
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Vui lòng thử lại"
      );
    } finally {
      setSaving(false);
    }
  }

  if (tier.scope === "retail") return null;

  return (
    <section className="border-b pb-4" aria-labelledby="branch-scope-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="branch-scope-title" className="text-sm font-semibold">
            Phạm vi chi nhánh
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Chi nhánh không được gán sẽ dùng bảng giá chung hoặc giá niêm yết.
          </p>
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={openEditor}>
            <Icon name="edit_location_alt" size={15} className="mr-1" />
            Thiết lập
          </Button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {loading ? (
          <span className="text-xs text-muted-foreground">Đang tải...</span>
        ) : assignments.length === 0 ? (
          <Badge variant="secondary">Chưa gán chi nhánh</Badge>
        ) : (
          assignments.map((assignment) => (
            <Badge key={assignment.id} variant="secondary" className="gap-1.5">
              <Icon name="store" size={13} />
              {branchById.get(assignment.branchId)?.name ?? "Chi nhánh"}
              <span className="font-normal text-muted-foreground">
                {formatAssignmentWindow(assignment)}
              </span>
            </Badge>
          ))
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Phạm vi chi nhánh</DialogTitle>
            <DialogDescription>
              Chọn nơi áp dụng “{tier.name}”. Một chi nhánh không thể dùng hai
              bảng giá trùng thời gian.
            </DialogDescription>
          </DialogHeader>

          <div className="divide-y rounded-lg border">
            {branches.map((branch) => {
              const draft = drafts.find((item) => item.branchId === branch.id);
              return (
                <div key={branch.id} className="p-3">
                  <label className="flex cursor-pointer items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={Boolean(draft)}
                      onChange={(event) =>
                        toggleBranch(branch.id, event.target.checked)
                      }
                      className="size-4 accent-primary"
                    />
                    {branch.name}
                  </label>

                  {draft && (
                    <div className="mt-3 grid gap-3 pl-6 sm:grid-cols-2">
                      <label className="space-y-1 text-xs font-medium">
                        Hiệu lực
                        <select
                          value={draft.validityMode}
                          onChange={(event) =>
                            updateDraft(branch.id, {
                              validityMode: event.target.value as
                                | "indefinite"
                                | "fixed",
                              endsAt:
                                event.target.value === "indefinite"
                                  ? undefined
                                  : draft.endsAt,
                            })
                          }
                          className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                        >
                          <option value="indefinite">Không thời hạn</option>
                          <option value="fixed">Có thời hạn</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-medium">
                        Bắt đầu
                        <Input
                          type="datetime-local"
                          value={draft.startsAt}
                          onChange={(event) =>
                            updateDraft(branch.id, { startsAt: event.target.value })
                          }
                        />
                      </label>
                      {draft.validityMode === "fixed" && (
                        <label className="space-y-1 text-xs font-medium sm:col-start-2">
                          Kết thúc
                          <Input
                            type="datetime-local"
                            value={draft.endsAt ?? ""}
                            onChange={(event) =>
                              updateDraft(branch.id, { endsAt: event.target.value })
                            }
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Hủy
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Icon name="progress_activity" size={15} className="mr-1 animate-spin" />}
              Lưu phạm vi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
