# Opens Windows Firewall for PhoneScreenGames and saves state for restore.
# Must run elevated.

$ErrorActionPreference = 'Stop'

$stateDir = Join-Path $env:LOCALAPPDATA 'PhoneScreenGames'
$stateFile = Join-Path $stateDir 'firewall-state.json'
$ports = @(3000, 8080, 3443)

if (-not (Test-Path $stateDir)) {
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
}

$state = @{
  savedAt = (Get-Date).ToString('o')
  allowRules = @()
  disabledBlockRules = @()
}

foreach ($port in $ports) {
  $displayName = "PhoneScreenGames Tennis $port"
  $existing = Get-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue | Select-Object -First 1

  if (-not $existing) {
    New-NetFirewallRule `
      -DisplayName $displayName `
      -Direction Inbound `
      -Protocol TCP `
      -LocalPort $port `
      -Action Allow `
      -Profile Any | Out-Null
    Write-Host "Created allow rule: $displayName"
    $state.allowRules += @{
      displayName = $displayName
      action = 'created'
      wasEnabled = $false
    }
  } else {
    $wasEnabled = [string]$existing.Enabled -eq 'True'
    Enable-NetFirewallRule -DisplayName $displayName | Out-Null
    Write-Host "Enabled allow rule: $displayName"
    $state.allowRules += @{
      displayName = $displayName
      action = 'enabled'
      wasEnabled = $wasEnabled
    }
  }
}

$blockRules = Get-NetFirewallRule -DisplayName 'Node.js JavaScript Runtime' -ErrorAction SilentlyContinue |
  Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and $_.Enabled -eq 'True' }

foreach ($rule in $blockRules) {
  Disable-NetFirewallRule -Name $rule.Name | Out-Null
  Write-Host "Disabled Node block rule: $($rule.DisplayName) [$($rule.Name)]"
  $state.disabledBlockRules += @{
    name = $rule.Name
    displayName = $rule.DisplayName
  }
}

$state | ConvertTo-Json -Depth 4 | Set-Content -Path $stateFile -Encoding UTF8
Write-Host "Firewall opened. State saved to $stateFile"
Write-Host 'FIREWALL_OPEN_OK'
