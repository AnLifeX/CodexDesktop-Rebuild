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
Write-Output 'CodexUpdater process scope: 6 cases passed'
