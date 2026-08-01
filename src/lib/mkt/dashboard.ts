import type { MktSupabaseClient } from "@/lib/mkt/api";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";

type SupabaseError = {
  code?: string;
  message?: string;
};

type ProfileRow = {
  id: string;
  tenant_id: string | null;
  full_name: string | null;
  email: string | null;
};

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  readiness_score: number | null;
  timeframe_start: string | null;
  timeframe_end: string | null;
  updated_at: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  acceptance_status: string;
  task_status: string;
  task_type: string | null;
  assignee_id: string | null;
  due_at: string | null;
  campaign_id: string | null;
  work_package_id: string | null;
  content_item_id: string | null;
  requires_leader_action: boolean | null;
  created_at: string | null;
};

type ContentRow = {
  id: string;
  title: string;
  content_status: string;
  risk_level: string | null;
  current_version: number | null;
  revision_count: number | null;
  campaign_id: string | null;
  updated_at: string | null;
};

type ReadinessRow = {
  id: string;
  title: string;
  status: string;
  required_role: string | null;
  confirmed_at: string | null;
};

type LeaderQueueRow = {
  tenant_id: string;
  branch_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  task_id: string;
  task_title: string;
  assignee_id: string | null;
  work_package_id: string | null;
  content_item_id: string | null;
  issue_type: string;
  issue_note: string | null;
  created_at: string | null;
};

export type MktMetric = {
  label: string;
  value: string;
  tone: string;
};

export type MktCampaignSummary = {
  id: string;
  name: string;
  status: string;
  readinessScore: number;
  timeframeStart: string | null;
  timeframeEnd: string | null;
};

export type MktTaskSummary = {
  id: string;
  title: string;
  owner: string;
  acceptanceStatus: string;
  taskStatus: string;
  taskType: string | null;
  dueAt: string | null;
  campaignId: string | null;
  contentItemId: string | null;
  requiresLeaderAction: boolean;
};

export type MktContentSummary = {
  id: string;
  title: string;
  status: string;
  riskLevel: string;
  version: string;
  revisionCount: number;
};

export type MktReadinessSummary = {
  id: string;
  title: string;
  status: string;
  requiredRole: string | null;
};

export type MktLeaderQueueItem = {
  taskId: string;
  title: string;
  campaignName: string;
  assigneeName: string;
  acceptanceStatus: string;
  taskStatus: string;
  dueAt: string | null;
};

export type MktDashboardData = {
  isConfigured: boolean;
  tenantId: string | null;
  warnings: string[];
  metrics: MktMetric[];
  campaigns: MktCampaignSummary[];
  tasks: MktTaskSummary[];
  contents: MktContentSummary[];
  readiness: MktReadinessSummary[];
  leaderQueue: MktLeaderQueueItem[];
  readinessScore: number;
};

function emptyDashboardData(
  tenantId: string | null,
  warnings: string[] = [],
): MktDashboardData {
  return {
    isConfigured: warnings.every((warning) => !isSchemaWarning(warning)),
    tenantId,
    warnings,
    metrics: buildMetrics([], [], [], []),
    campaigns: [],
    tasks: [],
    contents: [],
    readiness: [],
    leaderQueue: [],
    readinessScore: 0,
  };
}

function isSchemaWarning(warning: string) {
  const normalized = warning.toLowerCase();
  return (
    normalized.includes("42p01") ||
    normalized.includes("pgrst205") ||
    normalized.includes("schema cache") ||
    normalized.includes("does not exist") ||
    (normalized.includes("relation") && normalized.includes("does not exist"))
  );
}

function describeError(error: SupabaseError | null | undefined) {
  if (!error) return "Unknown error";
  return [error.code, error.message].filter(Boolean).join(": ");
}

async function safeArray<T>(
  warnings: string[],
  label: string,
  query: PromiseLike<{ data: T[] | null; error: SupabaseError | null }>,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) {
    warnings.push(`${label}: ${describeError(error)}`);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function safeMaybe<T>(
  warnings: string[],
  label: string,
  query: PromiseLike<{ data: T | null; error: SupabaseError | null }>,
): Promise<T | null> {
  const { data, error } = await query;
  if (error) {
    warnings.push(`${label}: ${describeError(error)}`);
    return null;
  }

  return data ?? null;
}

function buildProfileMap(profiles: ProfileRow[]) {
  return new Map(
    profiles.map((profile) => [
      profile.id,
      profile.full_name || profile.email || "Chưa gán tên",
    ]),
  );
}

function formatCount(value: number) {
  return value.toString();
}

function buildMetrics(
  campaigns: CampaignRow[],
  tasks: TaskRow[],
  contents: ContentRow[],
  leaderQueue: LeaderQueueRow[],
): MktMetric[] {
  return [
    {
      label: "Chiến dịch đang chạy",
      value: formatCount(campaigns.filter((item) => item.status === "running").length),
      tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
    },
    {
      label: "Cần nhận việc",
      value: formatCount(tasks.filter((item) => item.acceptance_status === "pending").length),
      tone: "border-sky-200 bg-sky-50 text-sky-700",
    },
    {
      label: "Chờ duyệt nội dung",
      value: formatCount(contents.filter((item) => item.content_status === "pending_review").length),
      tone: "border-amber-200 bg-amber-50 text-amber-700",
    },
    {
      label: "Cần Leader xử lý",
      value: formatCount(leaderQueue.length),
      tone: "border-rose-200 bg-rose-50 text-rose-700",
    },
  ];
}

export async function getMktDashboardData(
  supabase: MktSupabaseClient,
  identity?: { userId?: string | null; tenantId?: string | null; isLead?: boolean },
): Promise<MktDashboardData> {
  const warnings: string[] = [];
  const db = getMktDatabaseClient(supabase);
  let userId = identity?.userId ?? null;
  let tenantId = identity?.tenantId ?? null;

  if (!userId) {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return emptyDashboardData(null, ["auth: Chưa đăng nhập"]);
    }
    userId = user.id;
  }

  if (!tenantId) {
    const profile = await safeMaybe<ProfileRow>(
      warnings,
      "profiles",
      db
        .from<ProfileRow>("profiles")
        .select("id, tenant_id, full_name, email")
        .eq("id", userId)
        .maybeSingle(),
    );
    tenantId = profile?.tenant_id ?? null;
  }

  if (!tenantId) {
    return emptyDashboardData(null, [
      ...warnings,
      "profiles: Không tìm thấy tenant cho người dùng hiện tại",
    ]);
  }
  const campaignsPromise = safeArray<CampaignRow>(
    warnings,
    "mkt_campaigns",
    db
      .from<CampaignRow>("mkt_campaigns")
      .select("id, name, status, readiness_score, timeframe_start, timeframe_end, updated_at")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(6),
  );


  const [campaigns, tasks, contents, leaderQueue] = await Promise.all([
    campaignsPromise,
    safeArray<TaskRow>(
      warnings,
      "mkt_tasks",
      db
        .from<TaskRow>("mkt_tasks")
        .select(
          "id, title, acceptance_status, task_status, task_type, assignee_id, due_at, campaign_id, work_package_id, content_item_id, requires_leader_action, created_at",
        )
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(24),
    ),
    safeArray<ContentRow>(
      warnings,
      "mkt_content_items",
      db
        .from<ContentRow>("mkt_content_items")
        .select(
          "id, title, content_status, risk_level, current_version, revision_count, campaign_id, updated_at",
        )
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(8),
    ),
    // Leader queue chỉ dành cho Lead/CEO. Executor gọi sẽ bị INSUFFICIENT_ROLE
    // — đó là bình thường, KHÔNG đẩy vào warnings (tránh banner cảnh báo vô cớ).
    identity?.isLead ? (async (): Promise<LeaderQueueRow[]> => {
      const { data, error } = await db.rpc<LeaderQueueRow[]>("mkt_get_leader_queue", {
        p_branch_id: null,
        p_limit: 20,
        p_offset: 0,
      });
      if (error) {
        const msg = describeError(error).toUpperCase();
        if (!msg.includes("INSUFFICIENT_ROLE") && !msg.includes("UNAUTHENTICATED")) {
          warnings.push(`mkt_get_leader_queue: ${describeError(error)}`);
        }
        return [];
      }
      return Array.isArray(data) ? data : [];
    })() : Promise.resolve([]),
  ]);


  const latestCampaign = campaigns[0] ?? null;
  const assigneeIds = Array.from(
    new Set(
      [
        ...tasks.map((task) => task.assignee_id),
        ...leaderQueue.map((item) => item.assignee_id),
      ].filter(Boolean) as string[],
    ),
  );
  const [readiness, profiles] = await Promise.all([
    latestCampaign
      ? safeArray<ReadinessRow>(
          warnings,
          "mkt_campaign_readiness_items",
          db
            .from<ReadinessRow>("mkt_campaign_readiness_items")
            .select("id, title, status, required_role, confirmed_at")
            .eq("tenant_id", tenantId)
            .eq("campaign_id", latestCampaign.id)
            .order("created_at", { ascending: true })
            .limit(20),
        )
      : Promise.resolve([]),
    assigneeIds.length > 0
      ? safeArray<ProfileRow>(
          warnings,
          "profiles assignees",
          db
            .from<ProfileRow>("profiles")
            .select("id, tenant_id, full_name, email")
            .eq("tenant_id", tenantId)
            .in("id", assigneeIds),
        )
      : Promise.resolve([]),
  ]);
  const profileMap = buildProfileMap(profiles);

  const dashboardData: MktDashboardData = {
    isConfigured: warnings.every((warning) => !isSchemaWarning(warning)),
    tenantId,
    warnings,
    metrics: buildMetrics(campaigns, tasks, contents, leaderQueue),
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      readinessScore: campaign.readiness_score ?? 0,
      timeframeStart: campaign.timeframe_start,
      timeframeEnd: campaign.timeframe_end,
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      owner: task.assignee_id
        ? profileMap.get(task.assignee_id) ?? "Chưa gán tên"
        : "Chưa gán người phụ trách",
      acceptanceStatus: task.acceptance_status,
      taskStatus: task.task_status,
      taskType: task.task_type,
      dueAt: task.due_at,
      campaignId: task.campaign_id,
      contentItemId: task.content_item_id,
      requiresLeaderAction: task.requires_leader_action ?? false,
    })),
    contents: contents.map((content) => ({
      id: content.id,
      title: content.title,
      status: content.content_status,
      riskLevel: content.risk_level ?? "medium",
      version: `v${content.current_version ?? 1}`,
      revisionCount: content.revision_count ?? 0,
    })),
    readiness: readiness.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      requiredRole: item.required_role,
    })),
    leaderQueue: leaderQueue.map((item) => ({
      taskId: item.task_id,
      title: item.task_title,
      campaignName: item.campaign_name ?? "Chưa gán chiến dịch",
      assigneeName: item.assignee_id
        ? profileMap.get(item.assignee_id) ?? "Chưa gán tên"
        : "Chưa gán tên",
      acceptanceStatus: item.issue_type.toLowerCase(),
      taskStatus: item.issue_note ?? "needs_action",
      dueAt: item.created_at,
    })),
    readinessScore: latestCampaign?.readiness_score ?? 0,
  };

  return dashboardData;
}
