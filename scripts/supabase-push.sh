#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
fi

: "${SUPABASE_ACCESS_TOKEN:?Missing SUPABASE_ACCESS_TOKEN}"
: "${SUPABASE_PROJECT_REF:?Missing SUPABASE_PROJECT_REF}"
: "${SUPABASE_DB_PASSWORD:?Missing SUPABASE_DB_PASSWORD}"

npx supabase login --token "$SUPABASE_ACCESS_TOKEN" --workdir . --yes
npx supabase link --project-ref "$SUPABASE_PROJECT_REF" --workdir . --yes

# Supabase CLI may still prompt for confirmation; auto-confirm.
printf "y\n" | npx supabase db push --workdir . --password "$SUPABASE_DB_PASSWORD" --include-all $DRY_RUN --yes

echo "Done."
