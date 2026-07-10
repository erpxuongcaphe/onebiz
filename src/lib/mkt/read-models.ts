import type { MktSupabaseClient } from "@/lib/mkt/api";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import type { MktContext } from "@/lib/mkt/context";

// ────────────────────────────────────────────────────────────
// Read-models cho MKT Hub. Server components gọi các hàm này; RLS (00168)
// là chốt chặn thật — read-model chỉ tiện query + định hình dữ liệu.
// ────────────────────────────────────────────────────────────

export type MktMember = { id: string; name: string; role: string | null };

export async function getMktContext(supabase: MktSupabaseClient): Promise<MktContext> {
  const db = getMktDatabaseClient(supabase);
  const { data } = await db.rpc<MktContext>("mkt_get_my_context", {});
  return (data as MktContext) ?? { canView: false };
}

/** Danh sách nhân sự cùng tenant để chọn assignee/owner/reviewer. */
export async function getMktMembers(supabase: MktSupabaseClient): Promise<MktMember[]> {
  const db = getMktDatabaseClient(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const profile = await db
    .from<{ tenant_id: string | null }>("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  const tenantId = profile.data?.tenant_id;
  if (!tenantId) return [];

  const { data } = await db
    .from<{ id: string; full_name: string | null; email: string | null; role: string | null }>(
      "profiles",
    )
    .select("id, full_name, email, role")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name || p.email || "Chưa gán tên",
    role: p.role,
  }));
}

export type MktMyTask = {
  id: string;
  title: string;
  description: string | null;
  taskType: string | null;
  acceptanceStatus: string;
  taskStatus: string;
  dueAt: string | null;
  campaignId: string | null;
  campaignName: string | null;
  contentItemId: string | null;
  workloadPoints: number;
  blockedReason: string | null;
};

/** Task của chính user hiện tại (RLS lọc: assignee hoặc reviewer). */
export async function getMyTasks(supabase: MktSupabaseClient): Promise<MktMyTask[]> {
  const db = getMktDatabaseClient(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  type Row = {
    id: string;
    title: string;
    description: string | null;
    task_type: string | null;
    acceptance_status: string;
    task_status: string;
    due_at: string | null;
    campaign_id: string | null;
    content_item_id: string | null;
    workload_points: number | null;
    blocked_reason: string | null;
    assignee_id: string | null;
  };

  const { data } = await db
    .from<Row>("mkt_tasks")
    .select(
      "id, title, description, task_type, acceptance_status, task_status, due_at, campaign_id, content_item_id, workload_points, blocked_reason, assignee_id",
    )
    .eq("assignee_id", user.id)
    .is("deleted_at", null)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);

  const rows = data ?? [];
  const campaignIds = Array.from(
    new Set(rows.map((r) => r.campaign_id).filter(Boolean) as string[]),
  );
  const campaignNames = new Map<string, string>();
  if (campaignIds.length > 0) {
    const { data: camps } = await db
      .from<{ id: string; name: string }>("mkt_campaigns")
      .select("id, name")
      .in("id", campaignIds);
    (camps ?? []).forEach((c) => campaignNames.set(c.id, c.name));
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    taskType: r.task_type,
    acceptanceStatus: r.acceptance_status,
    taskStatus: r.task_status,
    dueAt: r.due_at,
    campaignId: r.campaign_id,
    campaignName: r.campaign_id ? campaignNames.get(r.campaign_id) ?? null : null,
    contentItemId: r.content_item_id,
    workloadPoints: r.workload_points ?? 1,
    blockedReason: r.blocked_reason,
  }));
}

export type MktCampaign = {
  id: string;
  name: string;
  objective: string | null;
  status: string;
  readinessScore: number;
  budget: number;
  timeframeStart: string | null;
  timeframeEnd: string | null;
};

export async function getCampaignList(supabase: MktSupabaseClient): Promise<MktCampaign[]> {
  const db = getMktDatabaseClient(supabase);
  type Row = {
    id: string;
    name: string;
    objective: string | null;
    status: string;
    readiness_score: number | null;
    budget_amount: number | null;
    timeframe_start: string | null;
    timeframe_end: string | null;
  };
  const { data } = await db
    .from<Row>("mkt_campaigns")
    .select("id, name, objective, status, readiness_score, budget_amount, timeframe_start, timeframe_end")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    objective: c.objective,
    status: c.status,
    readinessScore: c.readiness_score ?? 0,
    budget: c.budget_amount ?? 0,
    timeframeStart: c.timeframe_start,
    timeframeEnd: c.timeframe_end,
  }));
}

export type MktLeaderQueueItem = {
  taskId: string | null;
  title: string;
  campaignId: string | null;
  campaignName: string | null;
  assigneeName: string | null;
  contentItemId: string | null;
  issueType: string;
  issueNote: string | null;
  createdAt: string | null;
};

export async function getLeaderQueue(
  supabase: MktSupabaseClient,
  branchId?: string | null,
): Promise<MktLeaderQueueItem[]> {
  const db = getMktDatabaseClient(supabase);
  type Row = {
    task_id: string | null;
    task_title: string;
    campaign_id: string | null;
    campaign_name: string | null;
    assignee_id: string | null;
    content_item_id: string | null;
    issue_type: string;
    issue_note: string | null;
    created_at: string | null;
  };
  const { data, error } = await db.rpc<Row[]>("mkt_get_leader_queue", {
    p_branch_id: branchId ?? null,
    p_limit: 100,
    p_offset: 0,
  });
  if (error || !Array.isArray(data)) return [];

  const assigneeIds = Array.from(
    new Set(data.map((r) => r.assignee_id).filter(Boolean) as string[]),
  );
  const names = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: profs } = await db
      .from<{ id: string; full_name: string | null; email: string | null }>("profiles")
      .select("id, full_name, email")
      .in("id", assigneeIds);
    (profs ?? []).forEach((p) => names.set(p.id, p.full_name || p.email || "Chưa gán tên"));
  }

  return data.map((r) => ({
    taskId: r.task_id,
    title: r.task_title,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    assigneeName: r.assignee_id ? names.get(r.assignee_id) ?? "Chưa gán tên" : null,
    contentItemId: r.content_item_id,
    issueType: r.issue_type,
    issueNote: r.issue_note,
    createdAt: r.created_at,
  }));
}

export type MktApprovalItem = {
  id: string;
  title: string;
  campaignName: string | null;
  contentStatus: string;
  riskLevel: string;
  currentVersion: number;
  revisionCount: number;
  requiredApproverRole: string | null;
  latestUrl: string | null;
  latestNote: string | null;
};

export async function getApprovals(supabase: MktSupabaseClient): Promise<MktApprovalItem[]> {
  const db = getMktDatabaseClient(supabase);
  type Row = {
    id: string;
    title: string;
    campaign_id: string | null;
    content_status: string;
    risk_level: string | null;
    current_version: number | null;
    revision_count: number | null;
    required_approver_role: string | null;
  };
  const { data } = await db
    .from<Row>("mkt_content_items")
    .select(
      "id, title, campaign_id, content_status, risk_level, current_version, revision_count, required_approver_role",
    )
    .in("content_status", ["pending_review", "revision_required"])
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  const rows = data ?? [];
  const campaignIds = Array.from(new Set(rows.map((r) => r.campaign_id).filter(Boolean) as string[]));
  const campaignNames = new Map<string, string>();
  if (campaignIds.length > 0) {
    const { data: camps } = await db
      .from<{ id: string; name: string }>("mkt_campaigns")
      .select("id, name")
      .in("id", campaignIds);
    (camps ?? []).forEach((c) => campaignNames.set(c.id, c.name));
  }

  // Bản version mới nhất của từng content (để reviewer xem link).
  const latest = new Map<string, { url: string | null; note: string | null }>();
  if (rows.length > 0) {
    const { data: versions } = await db
      .from<{ content_item_id: string; version_number: number; content_url: string | null; note: string | null }>(
        "mkt_content_versions",
      )
      .select("content_item_id, version_number, content_url, note")
      .in("content_item_id", rows.map((r) => r.id));
    (versions ?? [])
      .sort((a, b) => a.version_number - b.version_number)
      .forEach((v) => latest.set(v.content_item_id, { url: v.content_url, note: v.note }));
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    campaignName: r.campaign_id ? campaignNames.get(r.campaign_id) ?? null : null,
    contentStatus: r.content_status,
    riskLevel: r.risk_level ?? "low",
    currentVersion: r.current_version ?? 0,
    revisionCount: r.revision_count ?? 0,
    requiredApproverRole: r.required_approver_role,
    latestUrl: latest.get(r.id)?.url ?? null,
    latestNote: latest.get(r.id)?.note ?? null,
  }));
}

export type MktCampaignDetail = {
  campaign: MktCampaign | null;
  workPackages: Array<{
    id: string;
    channelType: string;
    title: string;
    targetOutput: string | null;
    ownerName: string | null;
    reviewerName: string | null;
    status: string;
  }>;
  readiness: Array<{
    id: string;
    title: string;
    requiredRole: string | null;
    status: string;
    confirmedByName: string | null;
    dueAt: string | null;
    note: string | null;
  }>;
  contents: Array<{
    id: string;
    title: string;
    contentStatus: string;
    riskLevel: string;
    currentVersion: number;
    revisionCount: number;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    assigneeName: string | null;
    acceptanceStatus: string;
    taskStatus: string;
    taskType: string | null;
  }>;
};

export async function getCampaignDetail(
  supabase: MktSupabaseClient,
  campaignId: string,
): Promise<MktCampaignDetail> {
  const db = getMktDatabaseClient(supabase);

  const campaignRow = await db
    .from<{
      id: string;
      name: string;
      objective: string | null;
      status: string;
      readiness_score: number | null;
      budget_amount: number | null;
      timeframe_start: string | null;
      timeframe_end: string | null;
    }>("mkt_campaigns")
    .select("id, name, objective, status, readiness_score, budget_amount, timeframe_start, timeframe_end")
    .eq("id", campaignId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!campaignRow.data) {
    return { campaign: null, workPackages: [], readiness: [], contents: [], tasks: [] };
  }
  const c = campaignRow.data;

  const [wpRes, rdRes, ctRes, tkRes] = await Promise.all([
    db
      .from<{
        id: string;
        channel_type: string;
        title: string;
        target_output: string | null;
        owner_id: string | null;
        reviewer_id: string | null;
        status: string;
      }>("mkt_channel_work_packages")
      .select("id, channel_type, title, target_output, owner_id, reviewer_id, status")
      .eq("campaign_id", campaignId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    db
      .from<{
        id: string;
        title: string;
        required_role: string | null;
        status: string;
        confirmed_by: string | null;
        due_at: string | null;
        note: string | null;
      }>("mkt_campaign_readiness_items")
      .select("id, title, required_role, status, confirmed_by, due_at, note")
      .eq("campaign_id", campaignId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    db
      .from<{
        id: string;
        title: string;
        content_status: string;
        risk_level: string | null;
        current_version: number | null;
        revision_count: number | null;
      }>("mkt_content_items")
      .select("id, title, content_status, risk_level, current_version, revision_count")
      .eq("campaign_id", campaignId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    db
      .from<{
        id: string;
        title: string;
        assignee_id: string | null;
        acceptance_status: string;
        task_status: string;
        task_type: string | null;
      }>("mkt_tasks")
      .select("id, title, assignee_id, acceptance_status, task_status, task_type")
      .eq("campaign_id", campaignId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
  ]);

  const wp = wpRes.data ?? [];
  const rd = rdRes.data ?? [];
  const ct = ctRes.data ?? [];
  const tk = tkRes.data ?? [];

  // Tên người: gom mọi id cần tra.
  const ids = new Set<string>();
  wp.forEach((w) => {
    if (w.owner_id) ids.add(w.owner_id);
    if (w.reviewer_id) ids.add(w.reviewer_id);
  });
  rd.forEach((r) => r.confirmed_by && ids.add(r.confirmed_by));
  tk.forEach((t) => t.assignee_id && ids.add(t.assignee_id));
  const names = new Map<string, string>();
  if (ids.size > 0) {
    const { data: profs } = await db
      .from<{ id: string; full_name: string | null; email: string | null }>("profiles")
      .select("id, full_name, email")
      .in("id", Array.from(ids));
    (profs ?? []).forEach((p) => names.set(p.id, p.full_name || p.email || "Chưa gán tên"));
  }
  const nm = (id: string | null) => (id ? names.get(id) ?? "Chưa gán tên" : null);

  return {
    campaign: {
      id: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      readinessScore: c.readiness_score ?? 0,
      budget: c.budget_amount ?? 0,
      timeframeStart: c.timeframe_start,
      timeframeEnd: c.timeframe_end,
    },
    workPackages: wp.map((w) => ({
      id: w.id,
      channelType: w.channel_type,
      title: w.title,
      targetOutput: w.target_output,
      ownerName: nm(w.owner_id),
      reviewerName: nm(w.reviewer_id),
      status: w.status,
    })),
    readiness: rd.map((r) => ({
      id: r.id,
      title: r.title,
      requiredRole: r.required_role,
      status: r.status,
      confirmedByName: nm(r.confirmed_by),
      dueAt: r.due_at,
      note: r.note,
    })),
    contents: ct.map((x) => ({
      id: x.id,
      title: x.title,
      contentStatus: x.content_status,
      riskLevel: x.risk_level ?? "low",
      currentVersion: x.current_version ?? 0,
      revisionCount: x.revision_count ?? 0,
    })),
    tasks: tk.map((t) => ({
      id: t.id,
      title: t.title,
      assigneeName: nm(t.assignee_id),
      acceptanceStatus: t.acceptance_status,
      taskStatus: t.task_status,
      taskType: t.task_type,
    })),
  };
}
