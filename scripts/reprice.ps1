# Operator tool: run the catalog price normalization against production.
#   powershell -File scripts\reprice.ps1 -DryRun    # audit only
#   powershell -File scripts\reprice.ps1            # write prices
# Auth: CRON_SECRET bearer (read locally from .env.local, never printed).
param(
  [switch]$DryRun
)

$repo = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo '.env.local'
$line = Get-Content $envFile | Where-Object { $_ -match '^CRON_SECRET=' } | Select-Object -First 1
$secret = ($line -replace '^CRON_SECRET=', '').Trim('"').Trim("'")
if (-not $secret) { Write-Output 'CRON_SECRET not found in .env.local'; exit 1 }

$body = if ($DryRun) { '{"dryRun":true}' } else { '{}' }

try {
  $resp = Invoke-RestMethod -Method Post `
    -Uri 'https://octane-ajax.vercel.app/api/ajax/reprice-and-returns' `
    -Headers @{ Authorization = "Bearer $secret" } `
    -ContentType 'application/json' -Body $body -TimeoutSec 560
  Write-Output ("MODE=" + $(if ($DryRun) { 'DRY' } else { 'LIVE' }))
  Write-Output ("repriced=" + $resp.repriced)
  Write-Output ("alreadyCorrect=" + $resp.alreadyCorrect)
  Write-Output ("guardrailSkips=" + @($resp.guardrailSkips).Count)
  Write-Output ("failed=" + @($resp.failed).Count)
  foreach ($f in @($resp.failed)) { Write-Output ("  FAIL " + $f.listing + " :: " + $f.error) }
  foreach ($g in @($resp.guardrailSkips)) { Write-Output ("  GUARD " + $g.listing + " :: " + $g.reason) }
  Write-Output ("note=" + $resp.note)
} catch {
  $code = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
  Write-Output ("HTTP " + $code)
  try {
    $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Output $sr.ReadToEnd()
  } catch {}
}
