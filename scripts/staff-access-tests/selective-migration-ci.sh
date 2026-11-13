#!/usr/bin/env bash
# Disposable CI database only. This does not connect to ONEBIZ.
set -euo pipefail
test "${STAFF_EPHEMERAL_DB:-}" = onebiz_staff_access_test
db='postgresql://staff_test:ephemeral-test-only@127.0.0.1:55433/onebiz_staff_access_test'
scratch="${RUNNER_TEMP:?}/onebiz-migration-selection"
mkdir -p "$scratch/supabase/migrations"
printf 'project_id = "migration-selection-test"\n' > "$scratch/supabase/config.toml"
psql "$db" -Xq -v ON_ERROR_STOP=1 <<'SQL'
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text,
 created_by text, idempotency_key text, rollback text[]);
insert into supabase_migrations.schema_migrations(version,name) values
 ('20260101000000','existing_older'),('20260301000000','existing_newer');
SQL
# These represent already-recorded remote versions. If ever selected, they
# fail rather than silently marking an unexecuted historical migration applied.
for version in 20260101000000 20260301000000; do
  cat > "$scratch/supabase/migrations/${version}_remote_history_guard.sql" <<'SQL'
DO $$ BEGIN RAISE EXCEPTION 'HISTORY_GUARD_MUST_NOT_RUN'; END $$;
SQL
done
printf 'create table public.selective_test_marker(id integer);\n' > "$scratch/supabase/migrations/20260201000000_target.sql"
out="$scratch/dry-run.log"
supabase db push --remote="$db" --profile supabase --dry-run --skip-vault --include-all --workdir "$scratch" > "$out" 2>&1
grep -Fq '20260201000000_target.sql' "$out"
if grep -Fq '_remote_history_guard.sql' "$out"; then echo 'Unexpected history guard selected' >&2; exit 1; fi
supabase db push --remote="$db" --profile supabase --skip-vault --include-all --yes --workdir "$scratch" > "$scratch/push.log" 2>&1
psql "$db" -Xq -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 if to_regclass('public.selective_test_marker') is null then raise exception 'target not applied';end if;
 if (select count(*) from supabase_migrations.schema_migrations)<>3 then raise exception 'unexpected history mutation';end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20260201000000') then raise exception 'target version not preserved';end if;
end$$;
SQL
echo 'PASS disposable PostgreSQL: only the selected older migration is applied and its version preserved'

# A multi-migration push can fail after an earlier migration has committed.
# Exercise that failure mode so rollout and rollback never assume all-or-nothing.
printf 'create table public.stage_one_marker(id integer);\n' > "$scratch/supabase/migrations/20260401000000_stage_one.sql"
cat > "$scratch/supabase/migrations/20260501000000_stage_failure.sql" <<'SQL'
begin;
create table public.stage_failed_marker(id integer);
do $$begin raise exception 'EXPECTED_STAGE_FAILURE';end$$;
commit;
SQL
printf 'create table public.stage_three_marker(id integer);\n' > "$scratch/supabase/migrations/20260601000000_stage_three.sql"
if supabase db push --remote="$db" --profile supabase --skip-vault --include-all --yes --workdir "$scratch" > "$scratch/expected-failure.log" 2>&1; then
  echo 'Expected failing migration was unexpectedly accepted' >&2; exit 1
fi
grep -Fq 'EXPECTED_STAGE_FAILURE' "$scratch/expected-failure.log"
psql "$db" -Xq -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 if to_regclass('public.stage_one_marker') is null then raise exception 'earlier successful migration missing'; end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20260401000000') then raise exception 'earlier version missing'; end if;
 if to_regclass('public.stage_failed_marker') is not null or to_regclass('public.stage_three_marker') is not null then raise exception 'failed or later stage persisted'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version in ('20260501000000','20260601000000')) then raise exception 'failed or later version recorded'; end if;
end$$;
SQL
echo 'PASS disposable PostgreSQL: a failed stage leaves earlier committed stages visible and skips later stages'
