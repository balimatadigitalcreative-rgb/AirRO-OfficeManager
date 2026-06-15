# ============================================================================
#  AirRO Water - Finance Manager launcher
#  Starts the backend API + the frontend web server and opens the app.
#  First run also installs deps, creates the database, and seeds demo data.
#
#  Usage:   right-click start.bat -> "Run", or in a terminal:  .\start.ps1
#  Options: .\start.ps1 -NoBrowser      (don't open the browser)
#           .\start.ps1 -Reseed         (wipe + reseed the database)
# ============================================================================
param(
  [switch]$NoBrowser,
  [switch]$Reseed
)

$ErrorActionPreference = 'Stop'
$root    = $PSScriptRoot
$server  = Join-Path $root 'server'
$apiPort = 4000
$webPort = 8765

function Info($m) { Write-Host "[AirRO] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[AirRO] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "[AirRO] $m" -ForegroundColor Red; exit 1 }

# ---- prerequisites --------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die 'Node.js is not installed or not on PATH. Install from https://nodejs.org' }
Info "Node $(node --version)"

# pick a static-file server for the frontend: python (no-cache serve.py), then npx serve
$webCmd = $null; $webArgs = $null
$servePy = Join-Path $root 'serve.py'
if (Get-Command python -ErrorAction SilentlyContinue)      { $webCmd = 'python'; $webArgs = @($servePy,"$webPort") }
elseif (Get-Command py -ErrorAction SilentlyContinue)      { $webCmd = 'py';     $webArgs = @($servePy,"$webPort") }
elseif (Get-Command npx -ErrorAction SilentlyContinue)     { $webCmd = 'npx';    $webArgs = @('--yes','serve','-l',"$webPort",'.') }
else { Die 'No static server available (need python or npx).' }
Info "Web server: $webCmd"

# ---- first-run setup ------------------------------------------------------
Push-Location $server
try {
  if (-not (Test-Path (Join-Path $server 'node_modules'))) {
    Info 'Installing backend dependencies (first run)...'
    npm install
  }
  if (-not (Test-Path (Join-Path $server '.env'))) {
    Info 'Creating .env from template...'
    Copy-Item '.env.example' '.env'
  }
  $dbPath = Join-Path $server 'prisma\dev.db'
  if ($Reseed) {
    Info 'Resetting database...'
    npx prisma db push --force-reset --skip-generate
    node prisma/seed.js
  } elseif (-not (Test-Path $dbPath)) {
    Info 'Creating + seeding database (first run)...'
    npx prisma generate | Out-Null
    npx prisma db push --skip-generate
    node prisma/seed.js
  } else {
    # make sure the Prisma client is generated (cheap no-op if already there)
    npx prisma generate | Out-Null
  }
}
finally { Pop-Location }

# ---- is something already on the API port? --------------------------------
$apiUp = $false
try { $apiUp = (Invoke-WebRequest "http://localhost:$apiPort/api/v1/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch {}
if ($apiUp) { Warn "API already running on port $apiPort - reusing it." }

# ---- launch servers (each in its own window so logs are visible) ----------
if (-not $apiUp) {
  Info "Starting API on http://localhost:$apiPort ..."
  Start-Process -FilePath 'node' -ArgumentList 'src/server.js' -WorkingDirectory $server -WindowStyle Minimized
}
Info "Starting web server on http://localhost:$webPort ..."
Start-Process -FilePath $webCmd -ArgumentList $webArgs -WorkingDirectory $root -WindowStyle Minimized

# ---- wait for readiness ---------------------------------------------------
function Wait-Url($url, $name, $tries = 30) {
  for ($i = 0; $i -lt $tries; $i++) {
    try { if ((Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { return $true } } catch {}
    Start-Sleep -Milliseconds 500
  }
  Warn "$name did not respond at $url"; return $false
}
$apiOk = Wait-Url "http://localhost:$apiPort/api/v1/health" 'API'
$webOk = Wait-Url "http://localhost:$webPort/index.html"    'Web'

Write-Host ''
Info ("API  : http://localhost:$apiPort/api/v1   " + ($(if ($apiOk) {'[ready]'} else {'[not ready]'})))
Info ("App  : http://localhost:$webPort/          " + ($(if ($webOk) {'[ready]'} else {'[not ready]'})))
Info 'Demo logins: owner/1234  manager/2345  hrd/3456  finance/4567  admin/5678'
Write-Host ''
Info 'The two server windows are minimized. Close them (or run stop.ps1) to stop.'

# ---- open the app ---------------------------------------------------------
if (-not $NoBrowser -and $webOk) {
  Start-Process "http://localhost:$webPort/index.html"
}
