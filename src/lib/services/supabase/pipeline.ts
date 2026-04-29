// Pipeline Engine service — Core pipeline operations

import { getClient } from "./base";
import { getCurrentTenantId } from "./base";
import type {
  Pipeline,
  PipelineStage,
  PipelineItem,
  PipelineBoard,
  AllowedTransition,
  TimelineEntry,
} from "@/lib/types";

const supabase = getClient();

// ============================================================
// Pipeline CRUD
// ============================================================

export async function getPipelines() {
  const { data, error } = await supabase
    .from("pipelines")
    .select("*")
    .eq("is_active", true)
    .order("entity_type");

  if (error) throw error;
  return (data ?? []).map(mapPipeline);
}

export async function getPipelineByEntityType(entityType: string) {
  const { data, error } = await supabase
    .from("pipelines")
    .select("*")
    .eq("entity_type", entityType)
    .eq("is_active", true)
    .single();

  if (error) throw error;
  return mapPipeline(data);
}

export async function getPipelineStages(pipelineId: string) {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("sort_order");

  if (error) throw error;
  return (data ?? []).map(mapStage);
}

// ============================================================
// Pipeline Item operations
// ============================================================

export async function createPipelineItem(
  pipelineId: string,
  entityId: string,
  dimensions?: Record<string, string>
) {
  // Get initial stage
  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("is_initial", true)
    .single();

  if (!stages) throw new Error("No initial stage found for pipeline");

  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("pipeline_items")
    .insert({
      tenant_id: tenantId,
      pipeline_id: pipelineId,
      entity_id: entityId,
      current_stage_id: stages.id,
      dimensions: dimensions ?? {},
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getPipelineItemByEntity(
  entityType: string,
  entityId: string
) {
  const pipeline = await getPipelineByEntityType(entityType);

  const { data, error } = await supabase
    .from("pipeline_items")
    .select("*")
    .eq("pipeline_id", pipeline.id)
    .eq("entity_id", entityId)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

// ============================================================
// Pipeline RPCs (call Supabase functions)
// ============================================================

export async function transitionPipelineItem(
  pipelineItemId: string,
  toStageId: string,
  note?: string,
  dimensions?: Record<string, string>
) {
  const { data, error } = await supabase.rpc("pipeline_transition", {
    p_pipeline_item_id: pipelineItemId,
    p_to_stage_id: toStageId,
    p_note: note,
    p_dimensions: dimensions,
  });

  if (error) throw error;
  return data as { success: boolean; from_stage: string; to_stage: string };
}

export async function getAllowedTransitions(
  pipelineItemId: string
): Promise<AllowedTransition[]> {
  const { data, error } = await supabase.rpc(
    "pipeline_get_allowed_transitions",
    {
      p_pipeline_item_id: pipelineItemId,
    }
  );

  if (error) throw error;
  const items = (data as unknown[]) ?? [];
  return items.map((item) => {
    const t = item as Record<string, unknown>;
    return {
      transitionId: t.transition_id as string,
      name: t.name as string | undefined,
      toStageId: t.to_stage_id as string,
      toStageCode: t.to_stage_code as string,
      toStageName: t.to_stage_name as string,
      toStageColor: t.to_stage_color as string | undefined,
    };
  });
}

export async function getPipelineBoard(
  pipelineId: string
): Promise<PipelineBoard> {
  const { data, error } = await supabase.rpc("pipeline_get_board", {
    p_pipeline_id: pipelineId,
  });

  if (error) throw error;
  const raw = data as Record<string, unknown>;
  return {
    pipelineId: raw.pipeline_id as string,
    columns: (raw.columns as Record<string, unknown>[]).map((c) => ({
      stageId: c.stage_id as string,
      code: c.code as string,
      name: c.name as string,
      color: c.color as string | undefined,
      isInitial: c.is_initial as boolean,
      isFinal: c.is_final as boolean,
      items: (c.items as Record<string, unknown>[]).map((i) => ({
        id: i.id as string,
        entityId: i.entity_id as string,
        dimensions: (i.dimensions as Record<string, string>) ?? {},
        enteredAt: i.entered_at as string,
      })),
      count: c.count as number,
    })),
  };
}

export async function getPipelineTimeline(
  pipelineItemId: string
): Promise<TimelineEntry[]> {
  const { data, error } = await supabase.rpc("pipeline_get_timeline", {
    p_pipeline_item_id: pipelineItemId,
  });

  if (error) throw error;
  const entries = (data as unknown[]) ?? [];
  return entries.map((item) => {
    const e = item as Record<string, unknown>;
    return {
      id: e.id as string,
      changedAt: e.changed_at as string,
      note: e.note as string | undefined,
      fromStage: e.from_stage as string | undefined,
      fromStageCode: e.from_stage_code as string | undefined,
      fromColor: e.from_color as string | undefined,
      toStage: e.to_stage as string,
      toStageCode: e.to_stage_code as string,
      toColor: e.to_color as string | undefined,
      changedBy: e.changed_by as string | undefined,
    };
  });
}

// ============================================================
// Mappers
// ============================================================

function mapPipeline(row: Record<string, unknown>): Pipeline {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    entityType: row.entity_type as string,
    name: row.name as string,
    description: row.description as string | undefined,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
  };
}

function mapStage(row: Record<string, unknown>): PipelineStage {
  return {
    id: row.id as string,
    pipelineId: row.pipeline_id as string,
    code: row.code as string,
    name: row.name as string,
    color: row.color as string | undefined,
    icon: row.icon as string | undefined,
    sortOrder: row.sort_order as number,
    isInitial: row.is_initial as boolean,
    isFinal: row.is_final as boolean,
    validationRules: row.validation_rules as Record<string, unknown> | undefined,
    metadata: row.metadata as Record<string, unknown> | undefined,
  };
}
