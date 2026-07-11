"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { mktPost, mktDelete } from "@/lib/mkt/client";
import type { MktPillar } from "@/lib/mkt/read-models";

const DEFAULT_COLORS = ["#8B5A2B", "#2E8B57", "#D2691E", "#708090", "#1877F2", "#C13584"];

export function PillarManager({ pillars }: { pillars: MktPillar[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!code.trim() || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await mktPost("/api/mkt/v1/pillars", {
        code: code.trim(),
        name: name.trim(),
        color,
        sortOrder: pillars.length,
      });
      setCode("");
      setName("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await mktDelete(`/api/mkt/v1/pillars/${id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-outline-variant bg-background p-5">
      <h2 className="font-heading text-lg font-semibold">Content Pillars</h2>
      <p className="mt-1 text-sm text-on-surface-variant">
        Phân loại nội dung (P1–P4) dùng trên Kanban, lịch và báo cáo.
      </p>

      <div className="mt-4 space-y-2">
        {pillars.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5"
          >
            <span className="h-5 w-5 shrink-0 rounded" style={{ backgroundColor: p.color }} />
            <span className="w-16 shrink-0 text-xs font-semibold text-on-surface-variant">{p.code}</span>
            <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => remove(p.id)}
              className="text-on-surface-variant hover:text-rose-600 disabled:opacity-50"
            >
              <Icon name="delete" size={18} />
            </button>
          </div>
        ))}
        {pillars.length === 0 ? (
          <p className="text-sm text-on-surface-variant">Chưa có pillar nào.</p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-outline-variant pt-4">
        <div className="w-20">
          <label className="text-xs font-medium text-on-surface-variant">Mã</label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="P1" className="h-9" />
        </div>
        <div className="min-w-[140px] flex-1">
          <label className="text-xs font-medium text-on-surface-variant">Tên pillar</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cà phê tươi…"
            className="h-9"
          />
        </div>
        <div className="flex items-center gap-1">
          {DEFAULT_COLORS.map((c) => (
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
        <Button size="sm" disabled={busy || !code.trim() || !name.trim()} onClick={add}>
          <Icon name="add" size={16} /> Thêm
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm font-medium text-rose-600">{error}</p> : null}
    </div>
  );
}
