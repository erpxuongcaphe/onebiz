param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Require-Env($name) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing env var: $name"
  }
  return $value
}

$token = Require-Env "SUPABASE_ACCESS_TOKEN"
$projectRef = Require-Env "SUPABASE_PROJECT_REF"
$dbPassword = Require-Env "SUPABASE_DB_PASSWORD"

Write-Host "Logging in to Supabase CLI..."
npx supabase login --token $token --workdir . --yes

Write-Host "Linking project ref $projectRef..."
npx supabase link --project-ref $projectRef --workdir . --yes

$dryFlag = ""
if ($DryRun) { $dryFlag = "--dry-run" }

Write-Host "Pushing migrations..."
$cmd = "npx supabase db push --workdir . --password `"$dbPassword`" --include-all $dryFlag --yes"

# Supabase CLI may still prompt for confirmation; auto-confirm.
cmd /c "echo y| $cmd" | Out-Null

Write-Host "Done."
