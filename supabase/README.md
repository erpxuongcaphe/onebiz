## Supabase migrations

- Put SQL migrations in `supabase/migrations/`.
- Apply them using the Supabase CLI or the SQL editor in your Supabase project.

Suggested order (fresh project):
 - `001_core.sql`
- `002_inventory.sql`
- `003_sales.sql`
- `004_finance.sql`
 - `006_triggers.sql` (auto create profiles + seed roles)
 - `007_inventory_ops.sql` (inventory write policies + RPC)
 - `008_tenant_defaults.sql` (auto tenant_id on insert)
 - `005_seed_onebiz.sql` (optional demo data)
 - `010_inventory_hard_delete.sql` (inventory hard delete RPC)
 - `011_rbac.sql` (RBAC helpers + role permissions)
 - `012_inventory_rbac_policies.sql` (inventory RLS policies using RBAC)
 - `013_rbac_bootstrap.sql` (auto assign roles to users)
 - `014_rbac_rpc_guards.sql` (RBAC guards for security definer RPC)
 - `015_tenant_resolver.sql` (resolve tenant by hostname)
 - `016_branches.sql` (branches + default branch)
 - `017_audit_log.sql` (audit log + triggers)
 - `018_audit_permissions.sql` (grant audit.read to Admin)
 - `019_branches_backfill.sql` (set default branch for existing users)
 - `020_branch_defaults.sql` (default branch_id on warehouse inserts)
 - `021_pos.sql` (POS tables)
 - `022_pos_rbac_policies.sql` (POS RLS policies)
 - `023_pos_defaults.sql` (POS branch defaults)
 - `024_pos_permissions.sql` (seed Cashier + POS permissions)
 - `030_pos_sale_rpc.sql` (POS paid sale + stock deduction)
 - `031_pos_permissions_updates.sql` (POS permission refinements)
 - `025_inventory_documents.sql` (inventory receipts/issues/transfers)
 - `026_inventory_documents_rbac_policies.sql` (inventory docs RLS)
 - `027_inventory_documents_rpc.sql` (post inventory docs)
 - `028_inventory_document_permissions.sql` (grant doc perms to Admin/Manager)
 - `029_tenant_defaults_more.sql` (tenant_id defaults for new tables)
 - `032_inventory_documents_guards.sql` (prevent editing posted docs)
 - `033_inventory_documents_void.sql` (void docs + reverse stock)
 - `034_inventory_documents_permissions_update.sql` (grant void permission)
 - `035_inventory_documents_rbac_updates.sql` (update policy for doc lines)
 - `036_branch_switch.sql` (set current branch)
 - `037_branch_switch_permissions.sql` (grant branch.switch)

Automation (recommended):
- Windows PowerShell: `scripts/supabase-push.ps1`
- macOS/Linux: `scripts/supabase-push.sh`

Required env vars for automation:
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`

Required env (app side):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
