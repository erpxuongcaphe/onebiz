"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";
import { mktDelete, mktPost } from "@/lib/mkt/client";
import type { MktPillar, MktPillarAngle } from "@/lib/mkt/read-models";

const COLORS = ["#8B5A2B", "#2E8B57", "#D2691E", "#708090", "#1877F2", "#C13584"];

// Hiển thị khối văn bản nhiều dòng (guideline/kênh/format) — giữ nguyên xuống dòng.
function FieldBlock({ icon, label, value }: { icon: string; label: string; value: string | null }) {
  if (!value || !value.trim()) return null;
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1 text-xs font-semibold text-on-surface-variant">
        <Icon name={icon} size={14} /> {label}
      </div>
      <div className="whitespace-pre-line text-sm text-on-surface">{value}</div>
    </div>
  );
}

export function PillarBoard({
  pillars,
  angles,
  canManage,
}: {
  pillars: MktPillar[];
  angles: MktPillarAngle[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pillarDialog, setPillarDialog] = useState<{ open: boolean; edit: MktPillar | null }>({
    open: false,
    edit: null,
  });
  const [angleDialog, setAngleDialog] = useState<{
    open: boolean;
    pillarId: string;
    edit: MktPillarAngle | null;
  }>({ open: false, pillarId: "", edit: null });
  const [error, setError] = useState<string | null>(null);

  const anglesByPillar = useMemo(() => {
    const map = new Map<string, MktPillarAngle[]>();
    for (const a of angles) {
      const list = map.get(a.pillarId) ?? [];
      list.push(a);
      map.set(a.pillarId, list);
    }
    return map;
  }, [angles]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function removePillar(p: MktPillar) {
    if (!confirm(`Xoá trụ "${p.name}" và toàn bộ góc nội dung bên trong?`)) return;
    setError(null);
    try {
      await mktDelete(`/api/mkt/v1/pillars/${p.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được");
    }
  }

  async function removeAngle(a: MktPillarAngle) {
    if (!confirm(`Xoá góc nội dung "${a.title}"?`)) return;
    setError(null);
    try {
      await mktDelete(`/api/mkt/v1/pillar-angles/${a.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được");
    }
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setPillarDialog({ open: true, edit: null })}>
            <Icon name="add" size={16} /> Thêm trụ nội dung
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}

      {pillars.length === 0 ? (
        <div className="rounded-lg border border-dashed border-outline-variant bg-background p-8 text-center text-sm font-medium text-on-surface-variant">
          Chưa có trụ nội dung nào.
          {canManage ? " Bấm [Thêm trụ nội dung] để bắt đầu." : ""}
        </div>
      ) : null}

      <div className="space-y-4">
        {pillars.map((p) => {
          const pillarAngles = anglesByPillar.get(p.id) ?? [];
          return (
            <section key={p.id} className="rounded-xl border border-outline-variant bg-background p-4">
              {/* Header trụ */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className="mt-1 h-6 w-6 shrink-0 rounded-md"
                    style={{ backgroundColor: p.color }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-bold text-on-surface-variant">
                        {p.code}
                      </span>
                      <h2 className="font-heading text-lg font-semibold">{p.name}</h2>
                    </div>
                    {p.description ? (
                      <p className="mt-1 whitespace-pre-line text-sm text-on-surface-variant">
                        {p.description}
                      </p>
                    ) : null}
                  </div>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container"
                      title="Sửa trụ"
                      onClick={() => setPillarDialog({ open: true, edit: p })}
                    >
                      <Icon name="edit" size={18} />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-on-surface-variant hover:bg-rose-50 hover:text-rose-600"
                      title="Xoá trụ"
                      onClick={() => removePillar(p)}
                    >
                      <Icon name="delete" size={18} />
                    </button>
                  </div>
                ) : null}
              </div>

              {/* Danh sách góc nội dung (angles) */}
              <div className="mt-3 space-y-2">
                {pillarAngles.map((a) => {
                  const isOpen = expanded.has(a.id);
                  return (
                    <div
                      key={a.id}
                      className="rounded-lg border border-outline-variant bg-surface-container-lowest"
                    >
                      <div className="flex items-center gap-2 p-2.5">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => toggle(a.id)}
                        >
                          <Icon
                            name={isOpen ? "expand_more" : "chevron_right"}
                            size={18}
                            className="shrink-0 text-on-surface-variant"
                          />
                          <span className="truncate text-sm font-semibold">{a.title}</span>
                          {a.funnel ? (
                            <span className="hidden shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary sm:inline">
                              {a.funnel}
                            </span>
                          ) : null}
                        </button>
                        {canManage ? (
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              className="rounded p-1 text-on-surface-variant hover:bg-surface-container"
                              title="Sửa góc"
                              onClick={() => setAngleDialog({ open: true, pillarId: p.id, edit: a })}
                            >
                              <Icon name="edit" size={16} />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-on-surface-variant hover:bg-rose-50 hover:text-rose-600"
                              title="Xoá góc"
                              onClick={() => removeAngle(a)}
                            >
                              <Icon name="delete" size={16} />
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {isOpen ? (
                        <div className="space-y-3 border-t border-outline-variant px-3 py-3 pl-9">
                          {a.funnel ? (
                            <div className="sm:hidden">
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                {a.funnel}
                              </span>
                            </div>
                          ) : null}
                          <FieldBlock icon="lightbulb" label="Mô tả & Mục đích" value={a.description} />
                          <FieldBlock icon="checklist" label="Guideline / Check-list" value={a.guideline} />
                          <FieldBlock icon="hub" label="Kênh" value={a.channels} />
                          <FieldBlock icon="dashboard_customize" label="Format phù hợp" value={a.format} />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {canManage ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 pt-1 text-xs font-medium text-primary"
                    onClick={() => setAngleDialog({ open: true, pillarId: p.id, edit: null })}
                  >
                    <Icon name="add" size={14} /> Thêm góc nội dung
                  </button>
                ) : null}
                {pillarAngles.length === 0 && !canManage ? (
                  <p className="text-sm text-on-surface-variant">Chưa có góc nội dung.</p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      <PillarDialog
        state={pillarDialog}
        pillarCount={pillars.length}
        onClose={() => setPillarDialog({ open: false, edit: null })}
        onSaved={() => router.refresh()}
      />
      <AngleDialog
        state={angleDialog}
        angleCount={angleDialog.pillarId ? (anglesByPillar.get(angleDialog.pillarId)?.length ?? 0) : 0}
        onClose={() => setAngleDialog({ open: false, pillarId: "", edit: null })}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}

// ── Dialog thêm/sửa Trụ ──
function PillarDialog({
  state,
  pillarCount,
  onClose,
  onSaved,
}: {
  state: { open: boolean; edit: MktPillar | null };
  pillarCount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const edit = state.edit;
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");

  // Nạp giá trị khi mở (dùng key theo id để reset khi đổi target)
  const targetKey = state.open ? (edit?.id ?? "new") : "closed";
  if (targetKey !== key) {
    setKey(targetKey);
    setCode(edit?.code ?? "");
    setName(edit?.name ?? "");
    setDescription(edit?.description ?? "");
    setColor(edit?.color ?? COLORS[0]);
    setError(null);
  }

  async function save() {
    if (!code.trim() || !name.trim()) {
      setError("Cần nhập Mã và Tên trụ.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await mktPost("/api/mkt/v1/pillars", {
        id: edit?.id,
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        sortOrder: edit?.sortOrder ?? pillarCount,
      });
      onClose();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={state.open} onOpenChange={(o) => (loading ? null : o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{edit ? "Sửa trụ nội dung" : "Thêm trụ nội dung"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[80px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-code">Mã</Label>
              <Input id="p-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="P1" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Tên trụ</Label>
              <Input
                id="p-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Local guide / Story…"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-desc">Mô tả (tuỳ chọn)</Label>
            <Textarea
              id="p-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Định hướng chung của trụ này…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Màu</Label>
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={"h-7 w-7 rounded " + (color === c ? "ring-2 ring-offset-1 ring-primary" : "")}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={onClose}>
            Huỷ
          </Button>
          <Button disabled={loading} onClick={save}>
            {loading ? "Đang lưu…" : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog thêm/sửa Góc nội dung (Angle) ──
function AngleDialog({
  state,
  angleCount,
  onClose,
  onSaved,
}: {
  state: { open: boolean; pillarId: string; edit: MktPillarAngle | null };
  angleCount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const edit = state.edit;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [funnel, setFunnel] = useState("");
  const [guideline, setGuideline] = useState("");
  const [channels, setChannels] = useState("");
  const [format, setFormat] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");

  const targetKey = state.open ? (edit?.id ?? "new:" + state.pillarId) : "closed";
  if (targetKey !== key) {
    setKey(targetKey);
    setTitle(edit?.title ?? "");
    setDescription(edit?.description ?? "");
    setFunnel(edit?.funnel ?? "");
    setGuideline(edit?.guideline ?? "");
    setChannels(edit?.channels ?? "");
    setFormat(edit?.format ?? "");
    setError(null);
  }

  async function save() {
    if (!title.trim()) {
      setError("Cần nhập tên góc nội dung.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await mktPost("/api/mkt/v1/pillar-angles", {
        id: edit?.id,
        pillarId: state.pillarId,
        title: title.trim(),
        description: description.trim() || undefined,
        funnel: funnel.trim() || undefined,
        guideline: guideline.trim() || undefined,
        channels: channels.trim() || undefined,
        format: format.trim() || undefined,
        sortOrder: edit?.sortOrder ?? angleCount,
      });
      onClose();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={state.open} onOpenChange={(o) => (loading ? null : o ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{edit ? "Sửa góc nội dung" : "Thêm góc nội dung"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1.5">
              <Label htmlFor="a-title">Tên góc (Angle)</Label>
              <Input
                id="a-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Xưởng đi tìm bạn…"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-funnel">Giai đoạn phễu</Label>
              <Input
                id="a-funnel"
                value={funnel}
                onChange={(e) => setFunnel(e.target.value)}
                placeholder="Awareness → Interest"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-desc">Mô tả & Mục đích</Label>
            <Textarea
              id="a-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Nội dung là gì, nhằm mục đích gì…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-guide">Guideline / Check-list</Label>
            <Textarea
              id="a-guide"
              value={guideline}
              onChange={(e) => setGuideline(e.target.value)}
              rows={5}
              placeholder="Mỗi dòng 1 mục, VD:&#10;☐ Hook 3 giây đầu gây tò mò&#10;☐ Ly Xưởng xuất hiện tự nhiên"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="a-channels">Kênh</Label>
              <Textarea
                id="a-channels"
                value={channels}
                onChange={(e) => setChannels(e.target.value)}
                rows={3}
                placeholder="TikTok + Reels&#10;Facebook phụ + Threads"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-format">Format phù hợp</Label>
              <Textarea
                id="a-format"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                rows={3}
                placeholder="Video POV thực tế&#10;Ảnh + bài viết"
              />
            </div>
          </div>
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={onClose}>
            Huỷ
          </Button>
          <Button disabled={loading} onClick={save}>
            {loading ? "Đang lưu…" : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
