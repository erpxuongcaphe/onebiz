param([string]$PackageDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'

# Read-only local inventory. Never print command lines or configuration credentials.
function Get-OnebizFingerprint([string]$Value) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-','').ToLowerInvariant()).Substring(0,16) }
  finally { $algorithm.Dispose() }
}
$report = [ordered]@{ mode = 'READ_ONLY_LOCAL_NO_NETWORK_NO_PRINT'; generatedAt = (Get-Date).ToUniversalTime().ToString('o'); configuration = 'missing'; pointFingerprint = $null; projectHost = $null; credentialShapeValid = $false; files = @(); processes = @(); tasks = @(); warnings = @() }
$pointId = $null
try {
  $directory = (Resolve-Path -LiteralPath $PackageDirectory).Path
  $configFile = Join-Path $directory 'onebiz-print-point.json'
  if (Test-Path -LiteralPath $configFile) {
    try {
      $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
      $guid = [Guid]::Empty
      if ([Guid]::TryParse([string]$config.pointId,[ref]$guid)) {
        $pointId = $guid.ToString()
        $report.pointFingerprint = Get-OnebizFingerprint $pointId
      }
      $endpoint = $null
      $safeEndpoint = [Uri]::TryCreate([string]$config.url,[UriKind]::Absolute,[ref]$endpoint) -and $endpoint.Scheme -eq 'https' -and $endpoint.Host -match '^[a-z0-9]{20}\.supabase\.co$' -and -not $endpoint.UserInfo -and $endpoint.IsDefaultPort
      if ($safeEndpoint) { $report.projectHost = $endpoint.Host }
      $report.configuration = 'read'
      $report.credentialShapeValid = [bool]($pointId -and $safeEndpoint -and [string]$config.token -cmatch '^[a-f0-9]{64}$' -and -not [string]::IsNullOrWhiteSpace([string]$config.publicKey))
      $config = $null # Do not serialize the configuration or its hash.
    } catch { $report.configuration = 'unreadable'; $report.warnings += 'CONFIG_UNREADABLE_NO_CREDENTIALS_LOGGED' }
  }
  foreach ($name in @('agent.mjs','recovery.mjs','run.ps1','runtime.ps1')) {
    $file = Join-Path $directory $name
    if (Test-Path -LiteralPath $file) { $report.files += [ordered]@{ name = $name; sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() } }
  }
  try {
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop)
    foreach ($process in $processes) {
      $line = [string]$process.CommandLine
      if ($line -match '(?:[\\/]|["\s])agent\.mjs(?=["\s]|$)') {
        $report.processes += [ordered]@{ pid = [int]$process.ProcessId; parentPid = [int]$process.ParentProcessId; packagePathExplicitlyMatches = $line.IndexOf($directory,[StringComparison]::OrdinalIgnoreCase) -ge 0 }
      }
    }
  } catch { $report.warnings += 'PROCESS_METADATA_UNAVAILABLE' }
  if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
    try {
      foreach ($task in @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -like 'Onebiz Print Point *' })) {
        $report.tasks += [ordered]@{ taskFingerprint = Get-OnebizFingerprint ([string]$task.TaskName); state = [string]$task.State; matchesThisPoint = [bool]($pointId -and $task.TaskName -eq ('Onebiz Print Point ' + $pointId)) }
      }
    } catch { $report.warnings += 'TASK_METADATA_UNAVAILABLE' }
  } else { $report.warnings += 'TASK_COMMAND_UNAVAILABLE' }
  $report.warnings += 'RELATIVE_PROCESS_PATH_CANNOT_BE_ASSIGNED_TO_A_PACKAGE_WITH_CERTAINTY'
} catch { $report.warnings += 'PACKAGE_DIRECTORY_UNAVAILABLE' }
$report | ConvertTo-Json -Depth 6
