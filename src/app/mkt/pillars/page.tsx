import type { Metadata } from "next";
import { getMktRequestContext } from "@/lib/mkt/request-context";
import { getPillars, getPillarAngles } from "@/lib/mkt/read-models";
import { PillarBoard } from "@/components/mkt/pillar-board";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MKT Hub — Định hướng nội dung" };

export default async function PillarsPage() {
  const { supabase, ctx } = await getMktRequestContext();
  const [pillars, angles] = await Promise.all([
    getPillars(supabase),
    getPillarAngles(supabase),
  ]);

  return (
    <div className="px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
        <div className="flex flex-col gap-1 pb-1">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">
            Định hướng nội dung
          </h1>
          <p className="text-sm text-on-surface-variant">
            Content Pillars &amp; Angles — khung định hướng sản xuất nội dung: mỗi trụ gồm nhiều góc
            (angle) với mô tả, mục đích, guideline, kênh và format.
          </p>
        </div>

        <PillarBoard
          pillars={pillars}
          angles={angles}
          canManage={Boolean(ctx.canManageCampaigns)}
        />
      </div>
    </div>
  );
}
