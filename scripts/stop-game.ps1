# Stops PhoneScreenGames server/tunnel processes, then restores firewall.
param(
  [switch]$Quiet,
  [switch]$SkipFirewallRestore
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$tunnelFile = Join-Path $projectRoot 'public\tunnel.json'
$pidFile = Join-Path $env:LOCALAPPDATA 'PhoneScreenGames\pids.json'

function Write-Info($msg) {
  if (-not $Quiet) { Write-Host $msg }
}

function Stop-ProcessSafe($processId, $label) {
  if (-not $processId -or $processId -le 0) { return }
  try {
    Stop-Process -Id $processId -Force -ErrorAction Stop
    Write-Info "Stopped $label PID $processId"
  } catch {
    Write-Info "Could not stop $label PID $processId ($($_.Exception.Message))"
  }
}

function Stop-PortListeners($port) {
  $pids = @(
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  )
  foreach ($procId in $pids) {
    Stop-ProcessSafe $procId "port $port listener"
  }
}

Write-Info 'Stopping Phone Tennis...'

if (Test-Path $pidFile) {
  try {
    $saved = Get-Content -Path $pidFile -Raw -Encoding UTF8 | ConvertFrom-Json
    Stop-ProcessSafe ([int]$saved.startWithTunnel) 'start-with-tunnel'
    Stop-ProcessSafe ([int]$saved.server) 'server'
    Stop-ProcessSafe ([int]$saved.cloudflared) 'cloudflared'
  } catch {
    Write-Info 'Could not read saved PID file.'
  }
  Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
}

Stop-PortListeners 3000
Stop-PortListeners 8080
Stop-PortListeners 3443

$nodeProcs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $cmd = $_.CommandLine
    $cmd -and (
      $cmd -match 'start-with-tunnel\.js' -or
      $cmd -match 'PhoneScreenGames[\\/]+server\.js' -or
      $cmd -match 'PhoneScreenGames[\\/]+start-with-tunnel\.js'
    )
  }

foreach ($proc in @($nodeProcs)) {
  Stop-ProcessSafe $proc.ProcessId 'node (PhoneScreenGames)'
}

$cfProcs = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match '127\.0\.0\.1:3000|localhost:3000' }

foreach ($proc in @($cfProcs)) {
  Stop-ProcessSafe $proc.ProcessId 'cloudflared tunnel'
}

Start-Sleep -Seconds 1
Stop-PortListeners 3000

if (Test-Path $tunnelFile) {
  Remove-Item -Path $tunnelFile -Force -ErrorAction SilentlyContinue
  Write-Info 'Removed tunnel.json'
}

if (-not $SkipFirewallRestore) {
  $restoreScript = Join-Path $PSScriptRoot 'firewall-restore.ps1'
  Write-Info 'Restoring Windows Firewall...'
  if ([bool](net session 2>$null)) {
    powershell -NoProfile -ExecutionPolicy Bypass -File $restoreScript | Out-Null
  } else {
    Start-Process powershell `
      -Verb RunAs `
      -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$restoreScript`"" `
      -Wait | Out-Null
  }
}

Write-Info 'Phone Tennis stopped.'
Write-Info 'STOP_OK'
