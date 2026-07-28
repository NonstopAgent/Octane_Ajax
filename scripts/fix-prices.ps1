# Operator tool: fix Etsy-side prices for the three listings the Printify
# catalog reset cannot reach (no linked Printify product).
#   powershell -File scripts\fix-prices.ps1 -DryRun    # show what would change
#   powershell -File scripts\fix-prices.ps1            # write prices
# Auth: CRON_SECRET bearer (read locally from .env.local, never printed).
param(
  [switch]$DryRun
)

$repo = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo '.env.local'
$line = Get-Content $envFile | Where-Object { $_ -match '^CRON_SECRET=' } | Select-Object -First 1
$secret = ($line -replace '^CRON_SECRET=', '').Trim('"').Trim("'")
if (-not $secret) { Write-Output 'CRON_SECRET not found in .env.local'; exit 1 }

# The 2026-07-28 stragglers (flat traction prices; tees get the 2XL upcharge).
$payload = @{
  dryRun = [bool]$DryRun
  items  = @(
    @{ listingId = '4535313209'; priceUsd = 39.99 },                        # Blind Dog Mom Sweatshirt
    @{ listingId = '4533371136'; priceUsd = 29.99; twoXlPriceUsd = 31.99 }, # Pet Family Portrait Tee
    @{ listingId = '4533382735'; priceUsd = 29.99; twoXlPriceUsd = 31.99 }  # Multi Pet Portrait Tee
  )
} | ConvertTo-Json -Depth 5

try {
  $resp = Invoke-RestMethod -Method Post `
    -Uri 'https://octane-ajax.vercel.app/api/ajax/fix-listing-prices' `
    -Headers @{ Authorization = "Bearer $secret" } `
    -ContentType 'application/json' -Body $payload -TimeoutSec 110
  Write-Output ("MODE=" + $(if ($DryRun) { 'DRY' } else { 'LIVE' }))
  Write-Output ("ok=" + $resp.ok)
  foreach ($r in @($resp.results)) {
    Write-Output ("listing " + $r.listingId + " :: " + $r.status)
    foreach ($c in @($r.changes)) {
      Write-Output ("    " + $c.variation + " : " + ($c.from -join ',') + " -> " + $c.to)
    }
    if ($r.reason) { Write-Output ("    reason: " + $r.reason) }
    if ($r.error) { Write-Output ("    error: " + $r.error) }
  }
} catch {
  $code = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
  Write-Output ("HTTP " + $code)
  try {
    $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Output $sr.ReadToEnd()
  } catch {}
}
