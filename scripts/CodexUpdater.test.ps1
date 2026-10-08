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
$latestFull = $updater.GetMethod('LatestFullPackage', [System.Reflection.BindingFlags]'NonPublic, Static')
$package = $latestFull.Invoke($null, [object[]]@("AAA Codex-1-delta.nupkg 25`n0123456789abcdef0123456789abcdef01234567 Codex-2-full.nupkg 256`n"))
if ($package.Name -ne 'Codex-2-full.nupkg' -or $package.Size -ne 256) { throw 'Wrong full package selected' }
$isUpdater = $updater.GetMethod('IsInstalledUpdaterPath', [System.Reflection.BindingFlags]'NonPublic, Static')
$rootUpdate = Join-Path $root 'Update.exe'
$otherUpdate = Join-Path $env:WINDIR 'Update.exe'
if (-not $isUpdater.Invoke($null, [object[]]@("$root", "$rootUpdate")) -or
    $isUpdater.Invoke($null, [object[]]@("$root", "$otherUpdate"))) {
  throw 'Wrong updater process scope'
}
$createJob = $updater.GetMethod('CreateKillOnCloseJob', [System.Reflection.BindingFlags]'NonPublic, Static')
$assignJob = $updater.GetMethod('AssignProcessToJobObject', [System.Reflection.BindingFlags]'NonPublic, Static')
$closeJob = $updater.GetMethod('CloseHandle', [System.Reflection.BindingFlags]'NonPublic, Static')
$child = Start-Process -FilePath (Join-Path $env:WINDIR 'System32/ping.exe') -ArgumentList '127.0.0.1 -n 30' -WindowStyle Hidden -PassThru
try {
  $job = $createJob.Invoke($null, [object[]]@())
  try {
    if (-not $assignJob.Invoke($null, [object[]]@($job, $child.Handle))) { throw 'Could not assign test process to job' }
  } finally {
    $closeJob.Invoke($null, [object[]]@($job)) | Out-Null
  }
  if (-not $child.WaitForExit(5000)) { throw 'Closing the updater job left its child running' }
} finally {
  if (-not $child.HasExited) { $child.Kill() }
  $child.Dispose()
}
$format = $updater.GetMethod('FormatProgress', [System.Reflection.BindingFlags]'NonPublic, Static')
$bar = $format.Invoke($null, [object[]]@([long]1048576, [long]4194304))
if ($bar -notmatch '\[#{7}-{23}\] 25% \(1\.0/4\.0 MB\)') { throw "Wrong progress bar: $bar" }

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

$downloadAttempt = $updater.GetMethod('DownloadAttempt', [System.Reflection.BindingFlags]'NonPublic, Static')
$bytes = [byte[]](0..255)
$socket = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$socket.Start()
$port = ([Net.IPEndPoint]$socket.LocalEndpoint).Port
$socket.Stop()
$server = Start-ThreadJob -ArgumentList $port, $bytes -ScriptBlock {
  param($port, $bytes)
  $listener = [Net.HttpListener]::new()
  $listener.Prefixes.Add("http://127.0.0.1:$port/")
  $listener.Start()
  try {
    for ($attempt = 0; $attempt -lt 2; $attempt++) {
      $context = $listener.GetContext()
      $response = $context.Response
      if ($attempt -eq 0) {
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, 100)
        $response.Abort()
      } else {
        if ($context.Request.Headers['Range'] -ne 'bytes=100-') { throw 'Resume request omitted byte range' }
        $response.StatusCode = 206
        $response.AddHeader('Content-Range', 'bytes 100-255/256')
        $response.ContentLength64 = 156
        $response.OutputStream.Write($bytes, 100, 156)
        $response.Close()
      }
    }
  } finally { $listener.Stop(); $listener.Close() }
}
$partial = Join-Path ([IO.Path]::GetTempPath()) ("codex-updater-test-" + [guid]::NewGuid().ToString('N') + '.partial')
try {
  Start-Sleep -Milliseconds 500
  try { $downloadAttempt.Invoke($null, [object[]]@("http://127.0.0.1:$port/package.nupkg", "$partial", [long]256)) | Out-Null } catch {}
  if ((Get-Item $partial).Length -ne 100) { throw 'Interrupted download did not retain partial data' }
  $downloadAttempt.Invoke($null, [object[]]@("http://127.0.0.1:$port/package.nupkg", "$partial", [long]256)) | Out-Null
  if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($partial)) -ne [Convert]::ToBase64String($bytes)) {
    throw 'Resumed download content differs'
  }
  if (-not (Wait-Job $server -Timeout 5)) { throw 'Test HTTP server did not finish' }
  Receive-Job $server -ErrorAction Stop | Out-Null
} finally {
  Stop-Job $server -ErrorAction SilentlyContinue
  Remove-Job $server -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $partial -ErrorAction SilentlyContinue
}
Write-Output 'CodexUpdater process scope, feed parsing, resumable download, and log reading passed'
