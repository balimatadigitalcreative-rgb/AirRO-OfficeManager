# Stops the AirRO API (port 4000) and web server (port 8765) by freeing ports.
$ErrorActionPreference = 'SilentlyContinue'
foreach ($port in 4000, 8765) {
  $pids = (Get-NetTCPConnection -LocalPort $port -State Listen).OwningProcess | Sort-Object -Unique
  foreach ($procId in $pids) {
    if ($procId) {
      $name = (Get-Process -Id $procId).ProcessName
      Stop-Process -Id $procId -Force
      Write-Host "[AirRO] Stopped $name (pid $procId) on port $port" -ForegroundColor Yellow
    }
  }
}
Write-Host '[AirRO] Done.' -ForegroundColor Cyan
