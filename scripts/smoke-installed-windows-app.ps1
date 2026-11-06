param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$PackageVersion
)

$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Codex'
$exe = Join-Path $installRoot "app-$PackageVersion\ChatGPT.exe"
$installed = Start-Process -FilePath $Installer -WindowStyle Hidden -PassThru
if (-not $installed.WaitForExit(1800000)) { throw "Windows installer timed out" }
if ($installed.ExitCode -ne 0) { throw "Windows installer exited with $($installed.ExitCode)" }
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Installed app is missing: $exe" }

# Setup launches through Squirrel after exiting; wait for that launch to finish.
$deadline = [DateTime]::UtcNow.AddSeconds(90)
do {
  $updater = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.Equals((Join-Path $installRoot 'Update.exe'), [StringComparison]::OrdinalIgnoreCase) })
  if ($updater.Count -eq 0) { Start-Sleep -Seconds 2 }
} while ($updater.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)
if ($updater.Count -gt 0) { throw 'Squirrel launch did not finish' }
Get-CimInstance Win32_Process |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
node scripts/smoke-windows-app.js $exe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
