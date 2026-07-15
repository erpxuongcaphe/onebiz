"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { MktMember, MktPillar } from "@/lib/mkt/read-models";
import { useMktHref } from "@/components/mkt/mkt-routing";

type CampaignOption = { id: string; name: string };

/** Bộ lọc bảng tiến độ (đẩy lên URL để server lọc) + chú giải Pillar. */
export function KanbanFilters({
  members,
  campaigns,
  pillars,
}: {
  members: MktMember[];
  campaigns: CampaignOption[];
  pillars: MktPillar[];
}) {
  const router = useRouter();
  const toMktHref = useMktHref();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(toMktHref("/mkt/kanban" + (next.toString() ? "?" + next.toString() : "")));
  }

  const selectCls =
    "h-8 rounded-full border border-outline-variant bg-background px-3 text-xs font-medium text-on-surface-variant";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={params.get("campaign") ?? ""}
        onChange={(e) => setParam("campaign", e.target.value)}
        className={selectCls}
      >
        <option value="">Mọi chiến dịch</option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        value={params.get("assignee") ?? ""}
        onChange={(e) => setParam("assignee", e.target.value)}
        className={selectCls}
      >
        <option value="">Mọi người phụ trách</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      {pillars.length > 0 ? (
        <div className="ml-auto flex flex-wrap items-center gap-3 rounded-full border border-outline-variant bg-background px-3 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Định hướng
          </span>
          {pillars.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5 text-xs font-medium">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
              {p.code} · {p.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
