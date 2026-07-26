# Operator tool: run one autopilot pass against production, now.
#   powershell -File scripts\autopilot-run.ps1
#
# Same endpoint Vercel's hourly cron hits, same auth (CRON_SECRET bearer, read
# locally from .env.local and never printed). Useful when you want a pass
# immediately rather than at the top of the hour — and it prints the honest
# result rather than the green check the Vercel dashboard used to show for a
# pass that errored (2026-07-25 audit, M10c).
#
# Exit status mirrors the pass: 0 = clean, 1 = the pass reported errors.
# Overlap-safe: the autopilot_locks lease means this stands down cleanly if the
# hourly cron is already mid-pass, so running it "at the wrong moment" is fine.
param()

$repo = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo '.env.local'
if (-not (Test-Path $envFile)) { Write-Output "No .env.local at $envFile"; exit 1 }
$line = Get-Content $envFile | Where-Object { $_ -match '^CRON_SECRET=' } | Select-Object -First 1
$secret = ($line -replace '^CRON_SECRET=', '').Trim('"').Trim("'")
if (-not $secret) { Write-Output 'CRON_SECRET not found in .env.local'; exit 1 }

try {
  $resp = Invoke-RestMethod -Method Get `
    -Uri 'https://octane-ajax.vercel.app/api/cron/shop-autopilot' `
    -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 850
} catch {
  # A 500 here is the intended signal for a BROKEN loop (no Etsy connection, or
  # errors with nothing accomplished) — read the body, it carries the reason.
  $code = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
  Write-Output ("HTTP " + $code + " — the pass reported a broken loop")
  try {
    $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Output $sr.ReadToEnd()
  } catch {}
  exit 1
}

if ($resp.skipped) { Write-Output ("SKIPPED: " + $resp.skipped); exit 0 }

Write-Output ("ok=" + $resp.ok + "  etsyConnected=" + $resp.etsyConnected)
Write-Output ("audited=" + $resp.audited + "  tagsFixed=" + $resp.tagsFixed + "  shippingFixed=" + $resp.shippingFixed)
Write-Output ("recommended=" + $resp.recommended + "  promos=" + $resp.marketingQueued + "  reviewsCleared=" + $resp.reviewsCleared)
Write-Output ("cycleTriggered=" + $resp.cycleTriggered + "  takenDown=" + $resp.takenDown + "  galleryThin=" + $resp.galleryThin)
foreach ($n in @($resp.notices)) { Write-Output ("  NOTE  " + $n) }
foreach ($e in @($resp.errors)) { Write-Output ("  ERROR " + $e) }
if (-not $resp.ok) { exit 1 }
