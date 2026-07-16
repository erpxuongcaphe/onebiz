import type { MktSupabaseClient } from "@/lib/mkt/api";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import type { MktContext } from "@/lib/mkt/context";

// ────────────────────────────────────────────────────────────
// Read-models cho MKT Hub. Server components gọi các hàm này; RLS (00168)
// là chốt chặn thật — read-model chỉ tiện query + định hình dữ liệu.
// ────────────────────────────────────────────────────────────

function requireRows<T>(
  data: T[] | null,
  error: { message: string } | null,
  label: string,
): T[] {
  if (error) throw new Error(`MKT_READ_FAILED:${label}:${error.message}`);
  return data ?? [];
}

export type MktMember = { id: string; name: string; role: string | null };

export async function getMktContext(supabase: MktSupabaseClient): Promise<MktContext> {
  const db = getMktDatabaseClient(supabase);
  const { data, error } = await db.rpc<MktContext>("mkt_get_my_context", {});
  if (error) throw new Error(`MKT_READ_FAILED:context:${error.message}`);
  return (data as MktContext) ?? { canView: false };
}

/** Danh sách nhân sự cùng tenant để chọn assignee/owner/reviewer. */
export async function getMktMembers(
  supabase: MktSupabaseClient,
  knownTenantId?: string,
): Promise<MktMember[]> {
  const db = getMktDatabaseClient(supabase);
  let tenantId = knownTenantId;

  if (!tenantId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const profile = await db
      .from<{ tenant_id: string | null }>("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profile.error) throw new Error(`MKT_READ_FAILED:member_profile:${profile.error.message}`);
    tenantId = profile.data?.tenant_id ?? undefined;
  }

  if (!tenantId) return [];
  const { data, error } = await db
    .from<{ id: string; full_name: string | null; email: string | null; role: string | null }>(
      "profiles",
    )
    .select("id, full_name, email, role")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  return requireRows(data, error, "members").map((p) => ({
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
export async function getMyTasks(
  supabase: MktSupabaseClient,
  knownUserId?: string | null,
): Promise<MktMyTask[]> {
  const db = getMktDatabaseClient(supabase);
  let userId = knownUserId ?? null;

  if (!userId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }

  if (!userId) return [];
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

  const { data, error } = await db
    .from<Row>("mkt_tasks")
    .select(
      "id, title, description, task_type, acceptance_status, task_status, due_at, campaign_id, content_item_id, workload_points, blocked_reason, assignee_id",
    )
    .eq("assignee_id", userId)
    .is("deleted_at", null)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);

  const rows = requireRows(data, error, "my_tasks");
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
  const { data, error } = await db
    .from<Row>("mkt_campaigns")
    .select("id, name, objective, status, readiness_score, budget_amount, timeframe_start, timeframe_end")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  return requireRows(data, error, "campaigns").map((c) => ({
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
  if (error) throw new Error(`MKT_READ_FAILED:leader_queue:${error.message}`);
  if (!Array.isArray(data)) return [];

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

export type MktApprovalVersion = {
  versionNumber: number;
  url: string | null;
  note: string | null;
  status: string;
  submittedAt: string | null;
};

export type MktApprovalReview = {
  action: string;
  comment: string | null;
  reviewerName: string | null;
  createdAt: string | null;
};

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
  /** Lịch sử các bản nộp (mới nhất trước) */
  versions: MktApprovalVersion[];
  /** Lịch sử phản hồi duyệt (mới nhất trước) */
  reviews: MktApprovalReview[];
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
  const { data, error } = await db
    .from<Row>("mkt_content_items")
    .select(
      "id, title, campaign_id, content_status, risk_level, current_version, revision_count, required_approver_role",
    )
    .in("content_status", ["pending_review", "revision_required"])
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  const rows = requireRows(data, error, "approvals");
  const campaignIds = Array.from(new Set(rows.map((r) => r.campaign_id).filter(Boolean) as string[]));
  const campaignNames = new Map<string, string>();
  if (campaignIds.length > 0) {
    const { data: camps } = await db
      .from<{ id: string; name: string }>("mkt_campaigns")
      .select("id, name")
      .in("id", campaignIds);
    (camps ?? []).forEach((c) => campaignNames.set(c.id, c.name));
  }

  // Lịch sử bản nộp + phản hồi duyệt (timeline cho reviewer soi bối cảnh).
  type VersionRow = {
    content_item_id: string;
    version_number: number;
    content_url: string | null;
    note: string | null;
    status: string;
    submitted_at: string | null;
  };
  type ReviewRow = {
    content_item_id: string;
    action: string;
    comment: string | null;
    reviewer_id: string | null;
    created_at: string | null;
  };
  const versionsByContent = new Map<string, MktApprovalVersion[]>();
  const reviewsByContent = new Map<string, MktApprovalReview[]>();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const [versionsRes, reviewsRes] = await Promise.all([
      db
        .from<VersionRow>("mkt_content_versions")
        .select("content_item_id, version_number, content_url, note, status, submitted_at")
        .in("content_item_id", ids),
      db
        .from<ReviewRow>("mkt_content_reviews")
        .select("content_item_id, action, comment, reviewer_id, created_at")
        .in("content_item_id", ids),
    ]);

    const reviewerIds = Array.from(
      new Set((reviewsRes.data ?? []).map((r) => r.reviewer_id).filter(Boolean) as string[]),
    );
    const reviewerNames = new Map<string, string>();
    if (reviewerIds.length > 0) {
      const { data: profs } = await db
        .from<{ id: string; full_name: string | null; email: string | null }>("profiles")
        .select("id, full_name, email")
        .in("id", reviewerIds);
      (profs ?? []).forEach((p) =>
        reviewerNames.set(p.id, p.full_name || p.email || "Chưa gán tên"),
      );
    }

    (versionsRes.data ?? [])
      .sort((a, b) => b.version_number - a.version_number)
      .forEach((v) => {
        const arr = versionsByContent.get(v.content_item_id) ?? [];
        arr.push({
          versionNumber: v.version_number,
          url: v.content_url,
          note: v.note,
          status: v.status,
          submittedAt: v.submitted_at,
        });
        versionsByContent.set(v.content_item_id, arr);
      });

    (reviewsRes.data ?? [])
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
      .forEach((r) => {
        const arr = reviewsByContent.get(r.content_item_id) ?? [];
        arr.push({
          action: r.action,
          comment: r.comment,
          reviewerName: r.reviewer_id ? reviewerNames.get(r.reviewer_id) ?? "Chưa gán tên" : null,
          createdAt: r.created_at,
        });
        reviewsByContent.set(r.content_item_id, arr);
      });
  }

  return rows.map((r) => {
    const versions = versionsByContent.get(r.id) ?? [];
    return {
      id: r.id,
      title: r.title,
      campaignName: r.campaign_id ? campaignNames.get(r.campaign_id) ?? null : null,
      contentStatus: r.content_status,
      riskLevel: r.risk_level ?? "low",
      currentVersion: r.current_version ?? 0,
      revisionCount: r.revision_count ?? 0,
      requiredApproverRole: r.required_approver_role,
      latestUrl: versions[0]?.url ?? null,
      latestNote: versions[0]?.note ?? null,
      versions,
      reviews: reviewsByContent.get(r.id) ?? [],
    };
  });
}

export type MktWorkspaceTask = {
  id: string;
  title: string;
  assigneeId: string | null;
  assigneeName: string | null;
  acceptanceStatus: string;
  taskStatus: string;
  taskType: string | null;
  workloadPoints: number;
  campaignId: string | null;
  campaignName: string | null;
  dueAt: string | null;
  completedAt: string | null;
};

/** Toàn bộ task người dùng được phép thấy (RLS: lead → tất cả; executor → của mình). */
export async function getWorkspaceTasks(
  supabase: MktSupabaseClient,
): Promise<MktWorkspaceTask[]> {
  const db = getMktDatabaseClient(supabase);
  type Row = {
    id: string;
    title: string;
    assignee_id: string | null;
    acceptance_status: string;
    task_status: string;
    task_type: string | null;
    workload_points: number | null;
    campaign_id: string | null;
    due_at: string | null;
    completed_at: string | null;
  };
  const { data, error } = await db
    .from<Row>("mkt_tasks")
    .select(
      "id, title, assignee_id, acceptance_status, task_status, task_type, workload_points, campaign_id, due_at, completed_at",
    )
    .is("deleted_at", null)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(500);
  const rows = requireRows(data, error, "workspace_tasks");

  const assigneeIds = Array.from(new Set(rows.map((r) => r.assignee_id).filter(Boolean) as string[]));
  const campaignIds = Array.from(new Set(rows.map((r) => r.campaign_id).filter(Boolean) as string[]));
  const names = new Map<string, string>();
  const campaignNames = new Map<string, string>();
  await Promise.all([
    assigneeIds.length > 0
      ? db
          .from<{ id: string; full_name: string | null; email: string | null }>("profiles")
          .select("id, full_name, email")
          .in("id", assigneeIds)
          .then(({ data: d }) =>
            (d ?? []).forEach((p) => names.set(p.id, p.full_name || p.email || "Chưa gán tên")),
          )
      : Promise.resolve(),
    campaignIds.length > 0
      ? db
          .from<{ id: string; name: string }>("mkt_campaigns")
          .select("id, name")
          .in("id", campaignIds)
          .then(({ data: d }) => (d ?? []).forEach((c) => campaignNames.set(c.id, c.name)))
      : Promise.resolve(),
  ]);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_id ? names.get(r.assignee_id) ?? "Chưa gán tên" : null,
    acceptanceStatus: r.acceptance_status,
    taskStatus: r.task_status,
    taskType: r.task_type,
    workloadPoints: r.workload_points ?? 1,
    campaignId: r.campaign_id,
    campaignName: r.campaign_id ? campaignNames.get(r.campaign_id) ?? null : null,
    dueAt: r.due_at,
    completedAt: r.completed_at,
  }));
}

export type MktPillar = {
  id: string;
  code: string;
  name: string;
  color: string;
  sortOrder: number;
  description: string | null;
};

export async function getPillars(supabase: MktSupabaseClient): Promise<MktPillar[]> {
  const db = getMktDatabaseClient(supabase);
  const { data, error } = await db
    .from<{ id: string; code: string; name: string; color: string; sort_order: number; description: string | null }>(
      "mkt_content_pillars",
    )
    .select("id, code, name, color, sort_order, description")
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  return requireRows(data, error, "pillars").map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    color: p.color,
    sortOrder: p.sort_order,
    description: p.description ?? null,
  }));
}

export type MktPillarAngle = {
  id: string;
  pillarId: string;
  title: string;
  description: string | null;
  funnel: string | null;
  guideline: string | null;
  channels: string | null;
  format: string | null;
  sortOrder: number;
};

/** Toàn bộ Angle (góc nội dung) — page tự gom theo pillar. RLS lọc tenant + mkt.view. */
export async function getPillarAngles(supabase: MktSupabaseClient): Promise<MktPillarAngle[]> {
  const db = getMktDatabaseClient(supabase);
  const { data, error } = await db
    .from<{
      id: string;
      pillar_id: string;
      title: string;
      description: string | null;
      funnel: string | null;
      guideline: string | null;
      channels: string | null;
      format: string | null;
      sort_order: number;
    }>("mkt_content_pillar_angles")
    .select("id, pillar_id, title, description, funnel, guideline, channels, format, sort_order")
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  return requireRows(data, error, "pillar_angles").map((a) => ({
    id: a.id,
    pillarId: a.pillar_id,
    title: a.title,
    description: a.description ?? null,
    funnel: a.funnel ?? null,
    guideline: a.guideline ?? null,
    channels: a.channels ?? null,
    format: a.format ?? null,
    sortOrder: a.sort_order,
  }));
}

export type MktMediaAsset = {
  id: string;
  fileName: string;
  kind: string;
  status: string;
  sourceType: string;
  storagePath: string | null;
  externalUrl: string | null;
  externalId: string | null;
  thumbnailUrl: string | null;
  campaignId: string | null;
  createdAt: string | null;
};

export async function getMediaAssets(supabase: MktSupabaseClient): Promise<MktMediaAsset[]> {
  const db = getMktDatabaseClient(supabase);
  const { data, error } = await db
    .from<{
      id: string;
      file_name: string;
      kind: string;
      status: string;
      source_type: string | null;
      storage_path: string | null;
      external_url: string | null;
      external_id: string | null;
      thumbnail_url: string | null;
      campaign_id: string | null;
      created_at: string | null;
    }>("mkt_media_assets")
    .select(
      "id, file_name, kind, status, source_type, storage_path, external_url, external_id, thumbnail_url, campaign_id, created_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  return requireRows(data, error, "media").map((m) => ({
    id: m.id,
    fileName: m.file_name,
    kind: m.kind,
    status: m.status,
    sourceType: m.source_type ?? "upload",
    storagePath: m.storage_path,
    externalUrl: m.external_url,
    externalId: m.external_id,
    thumbnailUrl: m.thumbnail_url,
    campaignId: m.campaign_id,
    createdAt: m.created_at,
  }));
}

export type MktDocument = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  sourceType: string;
  externalUrl: string | null;
  externalId: string | null;
  thumbnailUrl: string | null;
  mimeType: string | null;
  storagePath: string | null;
  campaignId: string | null;
  createdAt: string | null;
};

/** Thư viện Tài liệu (xlsx/docx/pdf…) — RLS lọc theo tenant + mkt.view. */
export async function getDocuments(supabase: MktSupabaseClient): Promise<MktDocument[]> {
  const db = getMktDatabaseClient(supabase);
  const { data, error } = await db
    .from<{
      id: string;
      title: string;
      description: string | null;
      category: string;
      status: string;
      source_type: string | null;
      external_url: string | null;
      external_id: string | null;
      thumbnail_url: string | null;
      mime_type: string | null;
      storage_path: string | null;
      campaign_id: string | null;
      created_at: string | null;
    }>("mkt_documents")
    .select(
      "id, title, description, category, status, source_type, external_url, external_id, thumbnail_url, mime_type, storage_path, campaign_id, created_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(300);
  return requireRows(data, error, "documents").map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    category: d.category,
    status: d.status,
    sourceType: d.source_type ?? "other",
    externalUrl: d.external_url,
    externalId: d.external_id,
    thumbnailUrl: d.thumbnail_url,
    mimeType: d.mime_type,
    storagePath: d.storage_path,
    campaignId: d.campaign_id,
    createdAt: d.created_at,
  }));
}

export type MktExceptionEntry = {
  id: string;
  action: string;
  entityType: string;
  userName: string | null;
  reason: string | null;
  createdAt: string | null;
};

/** Exception Log — các hành vi vượt rào (override/miễn/ép hoàn tất). Cần mkt.view_audit. */
export async function getExceptionLog(
  supabase: MktSupabaseClient,
  campaignId?: string | null,
): Promise<MktExceptionEntry[]> {
  const db = getMktDatabaseClient(supabase);
  type RpcResult = {
    success: boolean;
    entries: Array<{
      id: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      user_id: string | null;
      new_data: Record<string, unknown> | null;
      created_at: string | null;
    }>;
  };
  const { data, error } = await db.rpc<RpcResult>("mkt_get_exception_log", {
    p_campaign_id: campaignId ?? null,
    p_limit: 50,
  });
  if (error) throw new Error(`MKT_READ_FAILED:exceptions:${error.message}`);
  if (!data || !Array.isArray((data as RpcResult).entries)) return [];
  const entries = (data as RpcResult).entries;

  const userIds = Array.from(new Set(entries.map((e) => e.user_id).filter(Boolean) as string[]));
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profs } = await db
      .from<{ id: string; full_name: string | null; email: string | null }>("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    (profs ?? []).forEach((p) => names.set(p.id, p.full_name || p.email || "Chưa gán tên"));
  }

  return entries.map((e) => ({
    id: e.id,
    action: e.action,
    entityType: e.entity_type,
    userName: e.user_id ? names.get(e.user_id) ?? "Chưa gán tên" : null,
    reason:
      (e.new_data?.["reason"] as string | undefined) ??
      (e.new_data?.["override_reason"] as string | undefined) ??
      null,
    createdAt: e.created_at,
  }));
}

export type MktCampaignDetail = {
  campaign: MktCampaign | null;
  workPackages: Array<{
    id: string;
    channelType: string;
    title: string;
    targetOutput: string | null;
    ownerId: string | null;
    reviewerId: string | null;
    ownerName: string | null;
    reviewerName: string | null;
    status: string;
    workloadPoints: number;
  }>;
  readiness: Array<{
    id: string;
    title: string;
    requiredRole: string | null;
    requiredBranchId: string | null;
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
    pillarId: string | null;
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

export type MktCampaignDetailTab = "channels" | "tasks" | "content" | "readiness";

export async function getCampaignDetail(
  supabase: MktSupabaseClient,
  campaignId: string,
  activeTab: MktCampaignDetailTab,
): Promise<MktCampaignDetail> {
  const db = getMktDatabaseClient(supabase);

  const [campaignRow, wpRes, rdRes, ctRes, tkRes] = await Promise.all([
    db
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
      .select(
        "id, name, objective, status, readiness_score, budget_amount, timeframe_start, timeframe_end",
      )
      .eq("id", campaignId)
      .is("deleted_at", null)
      .maybeSingle(),
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
      .order("created_at", { ascending: true })
      .limit(activeTab === "channels" ? 500 : 1),
    db
      .from<{
        id: string;
        title: string;
        required_role: string | null;
        required_branch_id: string | null;
        status: string;
        confirmed_by: string | null;
        due_at: string | null;
        note: string | null;
      }>("mkt_campaign_readiness_items")
      .select("id, title, required_role, required_branch_id, status, confirmed_by, due_at, note")
      .eq("campaign_id", campaignId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(activeTab === "readiness" ? 500 : 0),
    db
      .from<{
        id: string;
        title: string;
        content_status: string;
        risk_level: string | null;
        current_version: number | null;
        revision_count: number | null;
        pillar_id: string | null;
      }>("mkt_content_items")
      .select("id, title, content_status, risk_level, current_version, revision_count, pillar_id")
      .eq("campaign_id", campaignId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(activeTab === "channels" || activeTab === "content" ? 500 : 1),
    db
      .from<{
        id: string;
        title: string;
        assignee_id: string | null;
        acceptance_status: string;
        task_status: string;
        task_type: string | null;
        work_package_id: string | null;
        workload_points: number | null;
      }>("mkt_tasks")
      .select(
        "id, title, assignee_id, acceptance_status, task_status, task_type, work_package_id, workload_points",
      )
      .eq("campaign_id", campaignId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      // Tab khác vẫn lấy 1 dòng: bước "3. Chia việc" ở stepper kiểm tra
      // tasks.length > 0 — lấy 0 sẽ báo chưa chia việc dù đã chia
      // (giống cách workPackages/contents dùng limit 1).
      .limit(activeTab === "channels" || activeTab === "tasks" ? 1000 : 1),
  ]);

  if (campaignRow.error) {
    throw new Error(`MKT_READ_FAILED:campaign_detail:${campaignRow.error.message}`);
  }
  if (!campaignRow.data) {
    return { campaign: null, workPackages: [], readiness: [], contents: [], tasks: [] };
  }
  const c = campaignRow.data;

  const wp = requireRows(wpRes.data, wpRes.error, "campaign_work_packages");
  const rd = requireRows(rdRes.data, rdRes.error, "campaign_readiness");
  const ct = requireRows(ctRes.data, ctRes.error, "campaign_contents");
  const tk = requireRows(tkRes.data, tkRes.error, "campaign_tasks");

  const profileIds = new Set<string>();
  if (activeTab === "channels") {
    wp.forEach((item) => {
      if (item.owner_id) profileIds.add(item.owner_id);
      if (item.reviewer_id) profileIds.add(item.reviewer_id);
    });
  }
  if (activeTab === "readiness") {
    rd.forEach((item) => item.confirmed_by && profileIds.add(item.confirmed_by));
  }
  if (activeTab === "tasks") {
    tk.forEach((item) => item.assignee_id && profileIds.add(item.assignee_id));
  }

  const profiles = await (async () => {
    if (profileIds.size === 0) return [];
    const { data, error } = await db
      .from<{ id: string; full_name: string | null; email: string | null }>("profiles")
      .select("id, full_name, email")
      .in("id", Array.from(profileIds));
    return requireRows(data, error, "campaign_profiles");
  })();
  const names = new Map(
    profiles.map((profile) => [
      profile.id,
      profile.full_name || profile.email || "Chưa gán tên",
    ]),
  );
  const workloadByPackage = new Map<string, number>();
  tk.forEach((task) => {
    if (!task.work_package_id) return;
    workloadByPackage.set(
      task.work_package_id,
      (workloadByPackage.get(task.work_package_id) ?? 0) + (task.workload_points ?? 1),
    );
  });
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
      ownerId: w.owner_id,
      reviewerId: w.reviewer_id,
      ownerName: nm(w.owner_id),
      reviewerName: nm(w.reviewer_id),
      status: w.status,
      // Tổng điểm khối lượng của các task trong gói (đúng "Workload pts" prototype)
      workloadPoints: workloadByPackage.get(w.id) ?? 0,
    })),
    readiness: rd.map((r) => ({
      id: r.id,
      title: r.title,
      requiredRole: r.required_role,
      requiredBranchId: r.required_branch_id,
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
      pillarId: x.pillar_id,
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

// ── Bottom-Up Channel Planning ──────────────────────────────────
export type MktPlanItem = {
  id: string;
  title: string;
  taskType: string;
  description: string | null;
  contentAngle: string | null;
  deliverable: string | null;
  suggestedAssigneeId: string | null;
  reviewerId: string | null;
  contentItemId: string | null;
  workloadPoints: number;
  dueAt: string | null;
  sequence: number;
  isMandatory: boolean;
  dependsOnId: string | null;
};

export type MktContentOption = { id: string; title: string; campaignId: string | null };

/**
 * Danh sách nội dung của các chiến dịch — để gắn vào công đoạn Duyệt/Đăng khi
 * lập kế hoạch. Bắt buộc: task 'publish' không gắn nội dung sẽ KHÔNG bấm
 * "Bắt đầu" được (mkt_start_task chặn), nên phải chọn được ở màn lập kế hoạch.
 */
export async function getContentOptions(
  supabase: MktSupabaseClient,
  campaignIds: string[],
): Promise<MktContentOption[]> {
  if (campaignIds.length === 0) return [];
  const db = getMktDatabaseClient(supabase);
  const { data, error } = await db
    .from<{ id: string; title: string; campaign_id: string | null }>("mkt_content_items")
    .select("id, title, campaign_id")
    .in("campaign_id", campaignIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);
  return requireRows(data, error, "content_options").map((c) => ({
    id: c.id,
    title: c.title,
    campaignId: c.campaign_id,
  }));
}

// KPI định lượng của kế hoạch (00196). latestActual = số thực tế ở báo cáo
// GẦN NHẤT có ghi chỉ số này — để màn nào cũng so target/thực tế một kiểu.
export type MktPlanKpi = {
  id: string;
  name: string;
  unit: string | null;
  targetValue: number;
  sortOrder: number;
  latestActual: number | null;
};

// Một lần báo cáo tiến độ tổng thể (00196) — bất biến, xếp mới nhất trên cùng.
// stats do MÁY chụp từ task tại thời điểm báo cáo (chống báo cáo màu hồng).
export type MktPlanProgressReport = {
  id: string;
  health: string;
  summary: string;
  issues: string | null;
  nextSteps: string | null;
  stats: {
    tasksTotal?: number;
    tasksDone?: number;
    pointsTotal?: number;
    pointsDone?: number;
    overdue?: number;
  };
  planVersionNumber: number | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  entries: Array<{ kpiId: string; actualValue: number }>;
};

export type MktPlanInboxEntry = {
  id: string;
  workPackageId: string;
  campaignId: string;
  campaignName: string | null;
  channelTitle: string | null;
  status: string;
  versionNumber: number;
  currentVersionId: string | null;
  objective: string | null;
  keyMessage: string | null;
  mandatoryDeliverables: string | null;
  riskNotes: string | null;
  deadline: string | null;
  strategySummary: string | null;
  budgetPlanned: number | null;
  kpis: MktPlanKpi[];
  progressReports: MktPlanProgressReport[];
  ownerId: string | null;
  ownerName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
  items: MktPlanItem[];
  versions: Array<{
    versionNumber: number;
    status: string;
    reviewAction: string | null;
    reviewComment: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    assigneeId: string | null;
    assigneeName: string | null;
    acceptanceStatus: string;
    taskStatus: string;
    taskType: string | null;
  }>;
};

// Hộp thư kế hoạch: RLS tự lọc — Owner thấy plan của mình, Leader thấy tất cả.
export async function getPlanInbox(supabase: MktSupabaseClient): Promise<MktPlanInboxEntry[]> {
  const db = getMktDatabaseClient(supabase);
  const plansRes = await db
    .from<{
      id: string;
      work_package_id: string;
      campaign_id: string;
      owner_id: string | null;
      reviewer_id: string | null;
      status: string;
      version_number: number;
      current_version_id: string | null;
      objective: string | null;
      key_message: string | null;
      mandatory_deliverables: string | null;
      risk_notes: string | null;
      deadline: string | null;
      strategy_summary: string | null;
      budget_planned: number | string | null;
      submitted_at: string | null;
      updated_at: string | null;
    }>("mkt_channel_plans")
    .select(
      "id, work_package_id, campaign_id, owner_id, reviewer_id, status, version_number, current_version_id, objective, key_message, mandatory_deliverables, risk_notes, deadline, strategy_summary, budget_planned, submitted_at, updated_at",
    )
    .is("deleted_at", null)
    .in("status", ["planning", "submitted", "revision_required", "approved", "in_execution"])
    .order("updated_at", { ascending: false });
  const plans = requireRows(plansRes.data, plansRes.error, "plan_inbox");
  if (plans.length === 0) return [];

  const planIds = plans.map((p) => p.id);
  const wpIds = Array.from(new Set(plans.map((p) => p.work_package_id)));
  const campIds = Array.from(new Set(plans.map((p) => p.campaign_id)));

  const [itemsRes, wpRes, campRes, verRes, tasksRes, kpisRes, reportsRes] = await Promise.all([
    db
      .from<{
        id: string;
        plan_id: string;
        title: string;
        task_type: string;
        description: string | null;
        content_angle: string | null;
        deliverable: string | null;
        suggested_assignee_id: string | null;
        reviewer_id: string | null;
        content_item_id: string | null;
        workload_points: number | null;
        due_at: string | null;
        sequence: number | null;
        is_mandatory: boolean | null;
        depends_on_item_id: string | null;
      }>("mkt_channel_plan_items")
      .select(
        "id, plan_id, title, task_type, description, content_angle, deliverable, suggested_assignee_id, reviewer_id, content_item_id, workload_points, due_at, sequence, is_mandatory, depends_on_item_id",
      )
      .in("plan_id", planIds)
      .order("sequence", { ascending: true }),
    db
      .from<{ id: string; title: string }>("mkt_channel_work_packages")
      .select("id, title")
      .in("id", wpIds),
    db.from<{ id: string; name: string }>("mkt_campaigns").select("id, name").in("id", campIds),
    db
      .from<{
        plan_id: string;
        version_number: number;
        status: string;
        review_action: string | null;
        review_comment: string | null;
        submitted_at: string | null;
        reviewed_at: string | null;
      }>("mkt_channel_plan_versions")
      .select("plan_id, version_number, status, review_action, review_comment, submitted_at, reviewed_at")
      .in("plan_id", planIds)
      .order("version_number", { ascending: true }),
    db
      .from<{
        id: string;
        channel_plan_id: string | null;
        title: string;
        assignee_id: string | null;
        acceptance_status: string;
        task_status: string;
        task_type: string | null;
      }>("mkt_tasks")
      .select("id, channel_plan_id, title, assignee_id, acceptance_status, task_status, task_type")
      .in("channel_plan_id", planIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    db
      .from<{
        id: string;
        plan_id: string;
        name: string;
        unit: string | null;
        target_value: number | string;
        sort_order: number | null;
      }>("mkt_plan_kpis")
      .select("id, plan_id, name, unit, target_value, sort_order")
      .in("plan_id", planIds)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    db
      .from<{
        id: string;
        plan_id: string;
        health: string;
        summary: string;
        issues: string | null;
        next_steps: string | null;
        stats: MktPlanProgressReport["stats"] | null;
        plan_version_number: number | null;
        created_by: string | null;
        created_at: string;
      }>("mkt_plan_progress_reports")
      .select(
        "id, plan_id, health, summary, issues, next_steps, stats, plan_version_number, created_by, created_at",
      )
      .in("plan_id", planIds)
      .is("deleted_at", null)
      // Quy ước toàn hệ thống: dòng thời gian MỚI NHẤT TRÊN CÙNG.
      .order("created_at", { ascending: false }),
  ]);

  const wpTitle = new Map((wpRes.data ?? []).map((w) => [w.id, w.title] as const));
  const campName = new Map((campRes.data ?? []).map((c) => [c.id, c.name] as const));

  // Số thực tế từng KPI của các báo cáo (truy vấn nối tiếp vì cần id báo cáo).
  const reportRows = reportsRes.data ?? [];
  const reportIds = reportRows.map((r) => r.id);
  const entriesRes = reportIds.length
    ? await db
        .from<{ report_id: string; kpi_id: string; actual_value: number | string }>(
          "mkt_plan_kpi_entries",
        )
        .select("report_id, kpi_id, actual_value")
        .in("report_id", reportIds)
    : { data: [] as Array<{ report_id: string; kpi_id: string; actual_value: number | string }> };

  const pids = new Set<string>();
  plans.forEach((p) => {
    if (p.owner_id) pids.add(p.owner_id);
    if (p.reviewer_id) pids.add(p.reviewer_id);
  });
  (tasksRes.data ?? []).forEach((t) => {
    if (t.assignee_id) pids.add(t.assignee_id);
  });
  reportRows.forEach((r) => {
    if (r.created_by) pids.add(r.created_by);
  });
  const names = new Map<string, string>();
  if (pids.size > 0) {
    const { data: profs } = await db
      .from<{ id: string; full_name: string | null; email: string | null }>("profiles")
      .select("id, full_name, email")
      .in("id", Array.from(pids));
    (profs ?? []).forEach((p) => names.set(p.id, p.full_name || p.email || "Chưa gán tên"));
  }
  const nm = (id: string | null) => (id ? names.get(id) ?? "Chưa gán tên" : null);

  const versionsByPlan = new Map<string, MktPlanInboxEntry["versions"]>();
  (verRes.data ?? []).forEach((v) => {
    const arr = versionsByPlan.get(v.plan_id) ?? [];
    arr.push({
      versionNumber: v.version_number,
      status: v.status,
      reviewAction: v.review_action,
      reviewComment: v.review_comment,
      submittedAt: v.submitted_at,
      reviewedAt: v.reviewed_at,
    });
    versionsByPlan.set(v.plan_id, arr);
  });

  const itemsByPlan = new Map<string, MktPlanItem[]>();
  (itemsRes.data ?? []).forEach((it) => {
    const arr = itemsByPlan.get(it.plan_id) ?? [];
    arr.push({
      id: it.id,
      title: it.title,
      taskType: it.task_type,
      description: it.description,
      contentAngle: it.content_angle,
      deliverable: it.deliverable,
      suggestedAssigneeId: it.suggested_assignee_id,
      reviewerId: it.reviewer_id,
      contentItemId: it.content_item_id,
      workloadPoints: it.workload_points ?? 1,
      dueAt: it.due_at,
      sequence: it.sequence ?? 0,
      isMandatory: it.is_mandatory ?? false,
      dependsOnId: it.depends_on_item_id,
    });
    itemsByPlan.set(it.plan_id, arr);
  });

  const tasksByPlan = new Map<string, MktPlanInboxEntry["tasks"]>();
  (tasksRes.data ?? []).forEach((t) => {
    if (!t.channel_plan_id) return;
    const arr = tasksByPlan.get(t.channel_plan_id) ?? [];
    arr.push({
      id: t.id,
      title: t.title,
      assigneeId: t.assignee_id,
      assigneeName: nm(t.assignee_id),
      acceptanceStatus: t.acceptance_status,
      taskStatus: t.task_status,
      taskType: t.task_type,
    });
    tasksByPlan.set(t.channel_plan_id, arr);
  });

  // PostgREST trả numeric dạng CHUỖI ("50000.00") — phải ép số một cửa ở đây,
  // không để UI cộng chuỗi ra "50000.001" (bẫy kiểu dữ liệu).
  const num = (x: number | string | null | undefined) =>
    x == null ? null : Number(x);

  const entriesByReport = new Map<string, MktPlanProgressReport["entries"]>();
  (entriesRes.data ?? []).forEach((e) => {
    const arr = entriesByReport.get(e.report_id) ?? [];
    arr.push({ kpiId: e.kpi_id, actualValue: num(e.actual_value) ?? 0 });
    entriesByReport.set(e.report_id, arr);
  });

  const reportsByPlan = new Map<string, MktPlanProgressReport[]>();
  reportRows.forEach((r) => {
    const arr = reportsByPlan.get(r.plan_id) ?? [];
    arr.push({
      id: r.id,
      health: r.health,
      summary: r.summary,
      issues: r.issues,
      nextSteps: r.next_steps,
      stats: r.stats ?? {},
      planVersionNumber: r.plan_version_number,
      createdById: r.created_by,
      createdByName: nm(r.created_by),
      createdAt: r.created_at,
      entries: entriesByReport.get(r.id) ?? [],
    });
    reportsByPlan.set(r.plan_id, arr);
  });

  const kpisByPlan = new Map<string, MktPlanKpi[]>();
  (kpisRes.data ?? []).forEach((k) => {
    // Số thực tế gần nhất: báo cáo đã xếp MỚI NHẤT TRƯỚC → bản ghi đầu tiên thắng.
    let latest: number | null = null;
    for (const rep of reportsByPlan.get(k.plan_id) ?? []) {
      const hit = rep.entries.find((e) => e.kpiId === k.id);
      if (hit) {
        latest = hit.actualValue;
        break;
      }
    }
    const arr = kpisByPlan.get(k.plan_id) ?? [];
    arr.push({
      id: k.id,
      name: k.name,
      unit: k.unit,
      targetValue: num(k.target_value) ?? 0,
      sortOrder: k.sort_order ?? 0,
      latestActual: latest,
    });
    kpisByPlan.set(k.plan_id, arr);
  });

  return plans.map((p) => ({
    id: p.id,
    workPackageId: p.work_package_id,
    campaignId: p.campaign_id,
    campaignName: campName.get(p.campaign_id) ?? null,
    channelTitle: wpTitle.get(p.work_package_id) ?? null,
    status: p.status,
    versionNumber: p.version_number,
    currentVersionId: p.current_version_id,
    objective: p.objective,
    keyMessage: p.key_message,
    mandatoryDeliverables: p.mandatory_deliverables,
    riskNotes: p.risk_notes,
    deadline: p.deadline,
    strategySummary: p.strategy_summary,
    budgetPlanned: num(p.budget_planned),
    kpis: kpisByPlan.get(p.id) ?? [],
    progressReports: reportsByPlan.get(p.id) ?? [],
    ownerId: p.owner_id,
    ownerName: nm(p.owner_id),
    reviewerId: p.reviewer_id,
    reviewerName: nm(p.reviewer_id),
    submittedAt: p.submitted_at,
    updatedAt: p.updated_at,
    items: itemsByPlan.get(p.id) ?? [],
    versions: versionsByPlan.get(p.id) ?? [],
    tasks: tasksByPlan.get(p.id) ?? [],
  }));
}
