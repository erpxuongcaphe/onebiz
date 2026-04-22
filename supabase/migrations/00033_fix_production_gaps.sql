-- ============================================================
-- Migration 00033: Fix production gaps (AI Agents + duplicate RPC cleanup)
--
-- Context: Diagnostic query 22/04/2026 phát hiện production DB thiếu:
--   1. 4 tables cho AI Agents (agents, kpi_breakdowns, agent_tasks, agent_executions)
--   2. RPC seed_default_agents
--   3. Duplicate fnb_complete_payment_atomic (9-params version còn sót từ 00027)
--
-- Lý do migration 00025 gốc không chạy được trên production:
--   - RLS policies reference `public.user_tenants` (table không tồn tại trong schema này)
--   - Phải rewrite theo pattern chuẩn: `tenant_id = get_user_tenant_id()`
--
-- Safe to re-run: tất cả DDL đều có IF [NOT] EXISTS + DROP POLICY IF EXISTS.
-- ============================================================

-- ============================================================
-- 1. AI Agents tables
-- ============================================================

-- 1.1 agents — Định nghĩa agent (CEO, HR, Marketing, ...)
CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'ceo', 'hr', 'marketing', 'sales', 'operations', 'finance', 'custom'
  )),
  description TEXT,
  prompt_template TEXT,
  n8n_webhook_url TEXT,
  n8n_workflow_id TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_agent_code_per_tenant UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_agents_tenant ON public.agents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_role ON public.agents (tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_agents_active ON public.agents (tenant_id, is_active) WHERE is_active = true;

-- 1.2 kpi_breakdowns — KPI tổng → break down theo period (tree)
CREATE TABLE IF NOT EXISTS public.kpi_breakdowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.kpi_breakdowns(id) ON DELETE CASCADE,
  kpi_name TEXT NOT NULL,
  kpi_type TEXT NOT NULL CHECK (kpi_type IN (
    'revenue', 'orders', 'customers', 'profit', 'inventory', 'tasks', 'custom'
  )),
  period TEXT NOT NULL CHECK (period IN ('yearly', 'quarterly', 'monthly', 'weekly', 'daily')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  target_value NUMERIC(18, 2) NOT NULL,
  actual_value NUMERIC(18, 2) DEFAULT 0,
  unit TEXT,
  owner_role TEXT,
  owner_user_id UUID REFERENCES public.profiles(id),
  branch_id UUID REFERENCES public.branches(id),
  source_agent_id UUID REFERENCES public.agents(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT period_valid CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_kpi_breakdowns_tenant ON public.kpi_breakdowns (tenant_id);
CREATE INDEX IF NOT EXISTS idx_kpi_breakdowns_parent ON public.kpi_breakdowns (parent_id);
CREATE INDEX IF NOT EXISTS idx_kpi_breakdowns_period ON public.kpi_breakdowns (tenant_id, period, period_start);

-- 1.3 agent_tasks — Task hàng ngày cho nhân sự
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
  assigned_to_user_id UUID REFERENCES public.profiles(id),
  assigned_to_role TEXT,
  branch_id UUID REFERENCES public.branches(id),
  target_metric TEXT,
  actual_metric TEXT,
  due_time TIME,
  completed_at TIMESTAMPTZ,
  completed_by_user_id UUID REFERENCES public.profiles(id),
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_tenant ON public.agent_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_date ON public.agent_tasks (tenant_id, task_date);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON public.agent_tasks (tenant_id, status);

-- 1.4 agent_executions — Log mỗi lần n8n trigger agent
CREATE TABLE IF NOT EXISTS public.agent_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  trigger_source TEXT NOT NULL DEFAULT 'n8n' CHECK (trigger_source IN ('n8n', 'manual', 'cron')),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'timeout')),
  input_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  token_usage JSONB,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_executions_tenant ON public.agent_executions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_agent ON public.agent_executions (agent_id, triggered_at DESC);

-- ============================================================
-- 2. Trigger updated_at (reuse existing function if có, fallback tạo mới)
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
-- 3. RLS policies — pattern chuẩn `get_user_tenant_id()`
-- ============================================================
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_breakdowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY;

-- agents
DROP POLICY IF EXISTS "agents_select" ON public.agents;
DROP POLICY IF EXISTS "agents_insert" ON public.agents;
DROP POLICY IF EXISTS "agents_update" ON public.agents;
DROP POLICY IF EXISTS "agents_delete" ON public.agents;
DROP POLICY IF EXISTS "agents_tenant_scope" ON public.agents;

CREATE POLICY "agents_select" ON public.agents
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "agents_insert" ON public.agents
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "agents_update" ON public.agents
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "agents_delete" ON public.agents
  FOR DELETE USING (tenant_id = public.get_user_tenant_id());

-- kpi_breakdowns
DROP POLICY IF EXISTS "kpi_breakdowns_select" ON public.kpi_breakdowns;
DROP POLICY IF EXISTS "kpi_breakdowns_insert" ON public.kpi_breakdowns;
DROP POLICY IF EXISTS "kpi_breakdowns_update" ON public.kpi_breakdowns;
DROP POLICY IF EXISTS "kpi_breakdowns_delete" ON public.kpi_breakdowns;
DROP POLICY IF EXISTS "kpi_breakdowns_tenant_scope" ON public.kpi_breakdowns;

CREATE POLICY "kpi_breakdowns_select" ON public.kpi_breakdowns
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "kpi_breakdowns_insert" ON public.kpi_breakdowns
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "kpi_breakdowns_update" ON public.kpi_breakdowns
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "kpi_breakdowns_delete" ON public.kpi_breakdowns
  FOR DELETE USING (tenant_id = public.get_user_tenant_id());

-- agent_tasks
DROP POLICY IF EXISTS "agent_tasks_select" ON public.agent_tasks;
DROP POLICY IF EXISTS "agent_tasks_insert" ON public.agent_tasks;
DROP POLICY IF EXISTS "agent_tasks_update" ON public.agent_tasks;
DROP POLICY IF EXISTS "agent_tasks_delete" ON public.agent_tasks;
DROP POLICY IF EXISTS "agent_tasks_tenant_scope" ON public.agent_tasks;

CREATE POLICY "agent_tasks_select" ON public.agent_tasks
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "agent_tasks_insert" ON public.agent_tasks
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "agent_tasks_update" ON public.agent_tasks
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "agent_tasks_delete" ON public.agent_tasks
  FOR DELETE USING (tenant_id = public.get_user_tenant_id());

-- agent_executions
DROP POLICY IF EXISTS "agent_executions_select" ON public.agent_executions;
DROP POLICY IF EXISTS "agent_executions_insert" ON public.agent_executions;
DROP POLICY IF EXISTS "agent_executions_update" ON public.agent_executions;
DROP POLICY IF EXISTS "agent_executions_delete" ON public.agent_executions;
DROP POLICY IF EXISTS "agent_executions_tenant_scope" ON public.agent_executions;

CREATE POLICY "agent_executions_select" ON public.agent_executions
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "agent_executions_insert" ON public.agent_executions
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "agent_executions_update" ON public.agent_executions
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "agent_executions_delete" ON public.agent_executions
  FOR DELETE USING (tenant_id = public.get_user_tenant_id());

-- ============================================================
-- 4. Seed RPC — 6 agents mặc định
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

-- ============================================================
-- 5. Áp FK created_by → profiles cho bảng agents (đồng bộ 00032 pattern)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agents'
  ) THEN
    EXECUTE 'ALTER TABLE public.agents
      DROP CONSTRAINT IF EXISTS agents_created_by_fkey';
    EXECUTE 'ALTER TABLE public.agents
      ADD CONSTRAINT agents_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.profiles(id)';
  END IF;
END $$;

-- ============================================================
-- 6. Cleanup: drop duplicate fnb_complete_payment_atomic (9-params từ 00027)
--    Giữ lại version 10-params (00030) mà client đang dùng (có p_shift_id).
-- ============================================================
DROP FUNCTION IF EXISTS public.fnb_complete_payment_atomic(
  uuid,   -- p_kitchen_order_id
  uuid,   -- p_customer_id
  text,   -- p_customer_name
  text,   -- p_payment_method
  jsonb,  -- p_payment_breakdown
  numeric,-- p_paid
  numeric,-- p_discount_amount
  text,   -- p_note
  uuid    -- p_created_by
);

-- ============================================================
-- Verification queries (chạy sau khi apply):
--
-- SELECT routine_name FROM information_schema.routines
--  WHERE routine_name = 'fnb_complete_payment_atomic';
-- -- Expect: 1 row (chỉ 10-params version còn)
--
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public'
--    AND table_name IN ('agents', 'kpi_breakdowns', 'agent_tasks', 'agent_executions')
--  ORDER BY table_name;
-- -- Expect: 4 rows
--
-- SELECT routine_name FROM information_schema.routines
--  WHERE routine_name = 'seed_default_agents';
-- -- Expect: 1 row
-- ============================================================
