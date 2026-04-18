-- ============================================================
-- Migration 00025: AI Agent System Foundation (Phase Next)
-- ============================================================
-- Mục tiêu: schema foundation cho hệ thống AI Agent (n8n.io integration).
-- Các agent CEO/HR/Marketing/Sales/Operations/Finance sẽ:
--   1. Nhận KPI tổng từ CEO → break down theo period (day/week/month)
--   2. Tạo task hàng ngày cho nhân sự (AgentTask)
--   3. Log mỗi lần n8n trigger (AgentExecution)
-- RLS: toàn bộ scope theo tenant_id (CEO xem của mình, nhân viên chỉ thấy task được assign)
-- ============================================================

-- ============================================================
-- 1. agents — Định nghĩa agent (CEO, HR, Marketing, ...)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL, -- e.g. "ceo", "hr", "marketing"
  name TEXT NOT NULL, -- "CEO Agent", "HR Agent"
  role TEXT NOT NULL CHECK (role IN (
    'ceo', 'hr', 'marketing', 'sales', 'operations', 'finance', 'custom'
  )),
  description TEXT,
  prompt_template TEXT, -- System prompt cho LLM trong n8n workflow
  n8n_webhook_url TEXT, -- n8n webhook trigger endpoint
  n8n_workflow_id TEXT, -- n8n workflow reference (optional)
  config JSONB NOT NULL DEFAULT '{}'::jsonb, -- model/temperature/tools configuration
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT unique_agent_code_per_tenant UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_agents_tenant ON public.agents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_role ON public.agents (tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_agents_active ON public.agents (tenant_id, is_active) WHERE is_active = true;

-- ============================================================
-- 2. kpi_breakdowns — KPI tổng → break down theo period (tree)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.kpi_breakdowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.kpi_breakdowns(id) ON DELETE CASCADE,
  kpi_name TEXT NOT NULL, -- "Doanh thu tháng", "Khách mới ngày"
  kpi_type TEXT NOT NULL CHECK (kpi_type IN (
    'revenue', 'orders', 'customers', 'profit', 'inventory', 'tasks', 'custom'
  )),
  period TEXT NOT NULL CHECK (period IN ('yearly', 'quarterly', 'monthly', 'weekly', 'daily')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  target_value NUMERIC(18, 2) NOT NULL,
  actual_value NUMERIC(18, 2) DEFAULT 0,
  unit TEXT, -- "VND", "đơn", "khách", "%"
  owner_role TEXT, -- Role chịu trách nhiệm: "ceo" / "manager-branch-id" / nhân sự id
  owner_user_id UUID REFERENCES auth.users(id), -- Cụ thể ai chịu KPI này (optional)
  branch_id UUID REFERENCES public.branches(id), -- KPI theo chi nhánh (optional)
  source_agent_id UUID REFERENCES public.agents(id), -- Agent nào tạo KPI này
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT period_valid CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_kpi_breakdowns_tenant ON public.kpi_breakdowns (tenant_id);
CREATE INDEX IF NOT EXISTS idx_kpi_breakdowns_parent ON public.kpi_breakdowns (parent_id);
CREATE INDEX IF NOT EXISTS idx_kpi_breakdowns_period ON public.kpi_breakdowns (tenant_id, period, period_start);
CREATE INDEX IF NOT EXISTS idx_kpi_breakdowns_owner ON public.kpi_breakdowns (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kpi_breakdowns_branch ON public.kpi_breakdowns (branch_id) WHERE branch_id IS NOT NULL;

-- ============================================================
-- 3. agent_tasks — Task hàng ngày cho nhân sự
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  kpi_breakdown_id UUID REFERENCES public.kpi_breakdowns(id) ON DELETE SET NULL,
  task_date DATE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'done', 'skipped', 'blocked'
  )),
  assigned_to_user_id UUID REFERENCES auth.users(id),
  assigned_to_role TEXT, -- Nếu chưa biết ai cụ thể: "branch-1-cashier"
  branch_id UUID REFERENCES public.branches(id),
  target_metric TEXT, -- "Bán 50 đơn hôm nay"
  actual_metric TEXT, -- Kết quả thực tế
  due_time TIME, -- Hạn giờ trong ngày (optional)
  completed_at TIMESTAMPTZ,
  completed_by_user_id UUID REFERENCES auth.users(id),
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_tenant ON public.agent_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_date ON public.agent_tasks (tenant_id, task_date);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_assignee ON public.agent_tasks (assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON public.agent_tasks (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON public.agent_tasks (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_tasks_kpi ON public.agent_tasks (kpi_breakdown_id) WHERE kpi_breakdown_id IS NOT NULL;

-- ============================================================
-- 4. agent_executions — Log mỗi lần n8n trigger agent
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  trigger_source TEXT NOT NULL DEFAULT 'n8n' CHECK (trigger_source IN ('n8n', 'manual', 'cron')),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER, -- Thời gian chạy (ms)
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'timeout')),
  input_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  token_usage JSONB, -- {prompt_tokens, completion_tokens, total_tokens}
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_executions_tenant ON public.agent_executions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_agent ON public.agent_executions (agent_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_executions_status ON public.agent_executions (tenant_id, status);

-- ============================================================
-- 5. Trigger updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_set_updated_at_ai()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_agents_updated ON public.agents;
CREATE TRIGGER trg_agents_updated BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at_ai();

DROP TRIGGER IF EXISTS trg_kpi_breakdowns_updated ON public.kpi_breakdowns;
CREATE TRIGGER trg_kpi_breakdowns_updated BEFORE UPDATE ON public.kpi_breakdowns
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at_ai();

DROP TRIGGER IF EXISTS trg_agent_tasks_updated ON public.agent_tasks;
CREATE TRIGGER trg_agent_tasks_updated BEFORE UPDATE ON public.agent_tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at_ai();

-- ============================================================
-- 6. RLS Policies
-- ============================================================
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_breakdowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY;

-- agents: chỉ tenant thấy
DROP POLICY IF EXISTS "agents_tenant_scope" ON public.agents;
CREATE POLICY "agents_tenant_scope" ON public.agents
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
    )
  );

-- kpi_breakdowns: tenant scope
DROP POLICY IF EXISTS "kpi_breakdowns_tenant_scope" ON public.kpi_breakdowns;
CREATE POLICY "kpi_breakdowns_tenant_scope" ON public.kpi_breakdowns
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
    )
  );

-- agent_tasks: CEO thấy tất cả, nhân viên chỉ thấy task được assign
DROP POLICY IF EXISTS "agent_tasks_tenant_scope" ON public.agent_tasks;
CREATE POLICY "agent_tasks_tenant_scope" ON public.agent_tasks
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
    )
  );

-- agent_executions: tenant scope (CEO xem tất cả log)
DROP POLICY IF EXISTS "agent_executions_tenant_scope" ON public.agent_executions;
CREATE POLICY "agent_executions_tenant_scope" ON public.agent_executions
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 7. Seed 6 agent mặc định cho 1 tenant
-- ============================================================
CREATE OR REPLACE FUNCTION public.seed_default_agents(p_tenant_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.agents (tenant_id, code, name, role, description, prompt_template, is_active)
  VALUES
    (p_tenant_id, 'ceo', 'CEO Agent', 'ceo',
     'Agent cấp cao nhất — nhận input thị trường, quyết định KPI tổng toàn doanh nghiệp',
     'Bạn là CEO của chuỗi cà phê. Dựa trên dữ liệu thị trường + kết quả kinh doanh, hãy đề xuất KPI tháng cho toàn chuỗi...',
     true),
    (p_tenant_id, 'hr', 'HR Agent', 'hr',
     'Agent nhân sự — phân bổ task từ KPI xuống từng nhân viên theo năng lực',
     'Bạn là HR Manager. Nhận KPI từ CEO Agent, break down thành task hàng ngày cho từng nhân viên...',
     true),
    (p_tenant_id, 'marketing', 'Marketing Agent', 'marketing',
     'Agent tiếp thị — đề xuất chiến dịch khuyến mãi, phân tích khách hàng',
     'Bạn là Marketing Manager. Phân tích khách hàng, đề xuất promotion, viết content...',
     true),
    (p_tenant_id, 'sales', 'Sales Agent', 'sales',
     'Agent bán hàng — theo dõi doanh số, đề xuất upsell/cross-sell',
     'Bạn là Sales Manager. Theo dõi doanh số ngày, phát hiện cơ hội upsell...',
     true),
    (p_tenant_id, 'operations', 'Operations Agent', 'operations',
     'Agent vận hành — theo dõi tồn kho, sản xuất, điều phối chi nhánh',
     'Bạn là Operations Manager. Theo dõi tồn kho NVL, đề xuất lệnh sản xuất, chuyển kho...',
     true),
    (p_tenant_id, 'finance', 'Finance Agent', 'finance',
     'Agent tài chính — theo dõi dòng tiền, công nợ, chi phí',
     'Bạn là CFO. Theo dõi P&L, dòng tiền, cảnh báo rủi ro tài chính...',
     true)
  ON CONFLICT (tenant_id, code) DO NOTHING;
END $$;

COMMENT ON TABLE public.agents IS 'AI Agents cho n8n integration — 6 role mặc định: CEO, HR, Marketing, Sales, Operations, Finance';
COMMENT ON TABLE public.kpi_breakdowns IS 'KPI tree — CEO Agent tạo KPI tổng, HR Agent break down theo period xuống task';
COMMENT ON TABLE public.agent_tasks IS 'Task hàng ngày cho nhân sự, tạo bởi agent, link KPI';
COMMENT ON TABLE public.agent_executions IS 'Log mỗi lần n8n trigger agent — input/output/token usage';
