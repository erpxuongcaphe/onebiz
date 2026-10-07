$ErrorActionPreference = 'Stop'
function Get-OnebizNode {
  $bundledNode = Join-Path $PSScriptRoot 'runtime\node.exe'
  if (Test-Path -LiteralPath $bundledNode) { return $bundledNode }
  $existingNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($existingNode) {
    $nodeMajor = & $existingNode.Source -p 'process.versions.node.split(".")[0]'
    if ([int]$nodeMajor -ge 22) { return $existingNode.Source }
  }
  throw 'Node.js chua san sang. Chay Cai-diem-in.cmd de chuan bi.'
}
function Install-OnebizRuntime {
  try { return Get-OnebizNode } catch { }
  Write-Host 'Bo ket noi can Node.js. Se tai Node 24 LTS tu nodejs.org va kiem tra SHA256, chi dat trong thu muc nay.'
  if ((Read-Host 'Tai bo chay chinh thuc? Go Y de dong y') -ne 'Y') { throw 'Chua tai bo chay. Khong thay doi he thong.' }
  $runtimeIndex = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
  $runtimeRelease = $runtimeIndex | Where-Object { $_.version -match '^v24\.' -and $_.lts } | Select-Object -First 1
  if ($runtimeRelease.version -notmatch '^v24\.\d+\.\d+$') { throw 'Khong xac minh duoc phien ban Node LTS.' }
  $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $archiveName = 'node-' + $runtimeRelease.version + '-win-' + $architecture + '.zip'
  $vendorRoot = 'https://nodejs.org/dist/' + $runtimeRelease.version + '/'
  $manifest = (Invoke-WebRequest -Uri ($vendorRoot + 'SHASUMS256.txt') -UseBasicParsing).Content
  $expectedHash = (($manifest -split "`n" | Where-Object { $_.Trim().EndsWith('  ' + $archiveName) }) -split '\s+')[0]
  if ($expectedHash -notmatch '^[0-9a-f]{64}$') { throw 'Khong xac minh duoc SHA256.' }
  $archivePath = Join-Path $PSScriptRoot $archiveName
  Invoke-WebRequest -Uri ($vendorRoot + $archiveName) -OutFile $archivePath -UseBasicParsing
  if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLower() -ne $expectedHash) { throw 'SHA256 khong khop. Khong chay tep da tai.' }
  $unpackPath = Join-Path $PSScriptRoot 'runtime-download'
  Expand-Archive -LiteralPath $archivePath -DestinationPath $unpackPath -Force
  $sourceNode = Join-Path $unpackPath ('node-' + $runtimeRelease.version + '-win-' + $architecture + '\node.exe')
  $runtimePath = Join-Path $PSScriptRoot 'runtime'
  New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
  Copy-Item -LiteralPath $sourceNode -Destination (Join-Path $runtimePath 'node.exe')
  return Get-OnebizNode
}
