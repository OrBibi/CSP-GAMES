# Restores Windows Firewall to the state saved by firewall-open.ps1.
# Must run elevated.

$ErrorActionPreference = 'Stop'

$stateFile = Join-Path $env:LOCALAPPDATA 'PhoneScreenGames\firewall-state.json'

if (-not (Test-Path $stateFile)) {
  Write-Host 'No firewall state file found. Nothing to restore.'
  Write-Host 'FIREWALL_RESTORE_OK'
  exit 0
}

$state = Get-Content -Path $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json

foreach ($allow in @($state.allowRules)) {
  $displayName = [string]$allow.displayName
  $action = [string]$allow.action
  $wasEnabled = [bool]$allow.wasEnabled

  if ($action -eq 'created') {
    Disable-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue | Out-Null
    Write-Host "Disabled created allow rule: $displayName"
  } elseif (-not $wasEnabled) {
    Disable-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue | Out-Null
    Write-Host "Disabled allow rule again: $displayName"
  } else {
    Write-Host "Left allow rule enabled (was already enabled): $displayName"
  }
}

foreach ($block in @($state.disabledBlockRules)) {
  $ruleName = [string]$block.name
  Enable-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Out-Null
  Write-Host "Re-enabled Node block rule: $($block.displayName) [$ruleName]"
}

Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue
Write-Host 'Firewall restored.'
Write-Host 'FIREWALL_RESTORE_OK'
