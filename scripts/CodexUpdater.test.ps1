$ErrorActionPreference = 'Stop'
$updater = Add-Type -Path (Join-Path $PSScriptRoot 'CodexUpdater.cs') -PassThru |
  Where-Object Name -eq 'CodexUpdater'
$method = $updater.GetMethod('IsInstalledCodexPath', [System.Reflection.BindingFlags]'NonPublic, Static')
$root = Join-Path $env:LOCALAPPDATA 'Codex'
$cases = @(
  @{ Path = (Join-Path $root 'ChatGPT.exe'); Expected = $true },
  @{ Path = (Join-Path $root 'app-26.917.51856\resources\codex.exe'); Expected = $true },
  @{ Path = (Join-Path $root 'app-26.917.51856\resources\cua_node\bin\node_repl.exe'); Expected = $true },
  @{ Path = (Join-Path $root 'Update.exe'); Expected = $false },
  @{ Path = (Join-Path $env:LOCALAPPDATA 'nvm\node_modules\@openai\codex\codex.exe'); Expected = $false },
  @{ Path = (Join-Path $env:USERPROFILE '.vscode\extensions\openai.chatgpt\codex.exe'); Expected = $false }
)
foreach ($case in $cases) {
  $actual = $method.Invoke($null, [object[]]@("$root", "$($case.Path)"))
  if ($actual -ne $case.Expected) { throw "Wrong process scope: $($case.Path)" }
}

$parseSizes = $updater.GetMethod('ParsePackageSizes', [System.Reflection.BindingFlags]'NonPublic, Static')
$sizes = $parseSizes.Invoke($null, [object[]]@("ABC Codex-1-delta.nupkg 2527973`nDEF Codex-1.nupkg 812534448`n"))
if ($sizes['Codex-1-delta.nupkg'] -ne 2527973 -or $sizes['Codex-1.nupkg'] -ne 812534448) {
  throw 'Wrong RELEASES package sizes'
}

$readLines = $updater.GetMethod('ReadNewLogLines', [System.Reflection.BindingFlags]'NonPublic, Static')
$logFile = Join-Path ([IO.Path]::GetTempPath()) ("codex-updater-test-" + [guid]::NewGuid().ToString('N') + '.log')
try {
  [IO.File]::WriteAllText($logFile, "Downloading file: pkg")
  $arguments = [object[]]@("$logFile", [long]0, [string]::Empty)
  if (@($readLines.Invoke($null, $arguments)).Count -ne 0) { throw 'Incomplete log line was consumed' }
  [IO.File]::AppendAllText($logFile, ".nupkg`nInstalling files`n")
  $lines = @($readLines.Invoke($null, $arguments))
  if ($lines.Count -ne 2 -or $lines[0] -ne 'Downloading file: pkg.nupkg' -or $lines[1] -ne 'Installing files') {
    throw 'Incremental log lines were read incorrectly'
  }
} finally {
  Remove-Item -LiteralPath $logFile -ErrorAction SilentlyContinue
}
Write-Output 'CodexUpdater process scope, package sizes, and log reading passed'
