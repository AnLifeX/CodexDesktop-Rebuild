$ErrorActionPreference = 'Stop'
$testId = [guid]::NewGuid().ToString('N')
$temporary = Join-Path ([IO.Path]::GetTempPath()) "codex-install-integration-$testId"
$registryPrefix = "Software\CodexInstallTest-$testId"
$taskName = "Codex install test $testId"
New-Item -ItemType Directory -Path $temporary | Out-Null
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'WindowsInstall.cs') -Raw
# Only the compiled test fixture redirects Windows known folders and registry keys.
$source = $source.Replace('Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)', 'Environment.GetEnvironmentVariable("CODEX_INSTALL_FIXTURE")')
foreach ($folder in @('DesktopDirectory', 'StartMenu', 'Startup', 'Programs', 'ApplicationData')) {
  $source = $source.Replace("Environment.GetFolderPath(Environment.SpecialFolder.$folder)", "Path.Combine(Environment.GetEnvironmentVariable(`"CODEX_INSTALL_FIXTURE`"), `"$folder`")")
}
$source = $source.Replace('Software\Microsoft\Windows\CurrentVersion\', "$registryPrefix\")
$source = $source.Replace('Software\Classes\', "$registryPrefix\Classes\")
$source = $source.Replace('Codex retired versions', $taskName).Replace('Local\\CodexInstallMigration', "Local\\CodexInstallMigration-$testId")
$source += @'
public static class InstallFixture
{
    public static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--hold") { Thread.Sleep(60000); return 0; }
        if (args.Length > 0 && args[0].StartsWith("--maintenance-")) return WindowsInstall.Run(args);
        string exe = Assembly.GetExecutingAssembly().Location;
        string app = Path.GetDirectoryName(exe), root = Path.GetDirectoryName(app);
        if (args.Length == 2 && args[0] == "--age")
        {
            var state = WindowsInstall.Load(args[1]);
            state.HealthyUtc = DateTime.UtcNow.Subtract(TimeSpan.FromHours(25)).Ticks;
            foreach (var item in state.Versions) item.ExpiresUtc = DateTime.UtcNow.AddSeconds(-1).Ticks;
            WindowsInstall.Save(args[1], state);
            WindowsInstall.Cleanup(args[1], DateTime.UtcNow.Ticks);
            return 0;
        }
        string local = Environment.GetEnvironmentVariable("CODEX_INSTALL_FIXTURE");
        if (Path.GetFileName(app).StartsWith("app-"))
        {
            if (WindowsInstall.SamePath(root, Path.Combine(local, "Programs", "Codex")))
            {
                if (Environment.GetEnvironmentVariable("CODEX_INSTALL_FAIL_START") == "1") return 1;
                WindowsInstall.Confirm(root, Path.GetFileName(app));
            }
            else File.WriteAllText(Path.Combine(root, "fallback.txt"), "legacy app remains usable");
        }
        return 0;
    }
}
'@
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$sourcePath = Join-Path $temporary 'fixture.cs'
[IO.File]::WriteAllText($sourcePath, $source)
$fixtureExe = Join-Path $temporary 'fixture.exe'
& $compiler /nologo /target:exe "/out:$fixtureExe" $sourcePath
if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed' }
$savedFixture = $env:CODEX_INSTALL_FIXTURE
$savedFailure = $env:CODEX_INSTALL_FAIL_START
try {
  foreach ($scenario in @('success', 'failed-start')) {
    $local = Join-Path $temporary $scenario
    $env:CODEX_INSTALL_FIXTURE = $local
    $env:CODEX_INSTALL_FAIL_START = if ($scenario -eq 'failed-start') { '1' } else { '0' }
    $root = Join-Path $local 'Codex'
    $target = Join-Path $local 'Programs\Codex'
    $app = Join-Path $root 'app-2.0.0'
    foreach ($folder in @('resources', '..\app-1.0.0', '..\packages', '..\update-cache', '..\custom-empty')) {
      New-Item -ItemType Directory -Path (Join-Path $app $folder) -Force | Out-Null
    }
    foreach ($folder in @('DesktopDirectory', 'StartMenu', 'Startup', 'Programs', 'ApplicationData')) {
      New-Item -ItemType Directory -Path (Join-Path $local $folder) -Force | Out-Null
    }
    foreach ($name in @('Update.exe', 'Codex.exe', 'ChatGPT.exe', 'CodexUpdater.exe')) { Copy-Item -LiteralPath $fixtureExe -Destination (Join-Path $root $name) }
    Copy-Item -LiteralPath $fixtureExe -Destination (Join-Path $app 'ChatGPT.exe')
    Copy-Item -LiteralPath $fixtureExe -Destination (Join-Path $app 'CodexUpdater.exe')
    [IO.File]::WriteAllText((Join-Path $app 'resources\app.asar'), 'application resources')
    [IO.File]::WriteAllText((Join-Path $root 'packages\RELEASES'), 'manifest')
    [IO.File]::WriteAllText((Join-Path $root 'packages\complete.nupkg'), 'full package bytes')
    [IO.File]::WriteAllText((Join-Path $root 'update-cache\partial'), 'keep cache')
    [IO.File]::WriteAllText((Join-Path $root '.custom'), 'keep custom file')
    [IO.File]::WriteAllText((Join-Path $root 'app-1.0.0\old.txt'), 'keep old version')
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$registryPrefix\Uninstall\Codex")
    $key.SetValue('InstallLocation', $root)
    $key.SetValue('UninstallString', "`"$root\Update.exe`" --uninstall")
    $key.Close()
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$registryPrefix\Classes\codex\shell\open\command")
    $key.SetValue('', '"D:\historical-portable\Codex.exe" "%1"')
    $key.Close()
    $shell = New-Object -ComObject WScript.Shell
    $shortcutPath = Join-Path $local 'Startup\Codex.lnk'
    $link = $shell.CreateShortcut($shortcutPath)
    $link.TargetPath = Join-Path $root 'Codex.exe'
    $link.Save()
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) | Out-Null
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null

    # The nonexistent parent PID simulates the app having exited before copying.
    & $fixtureExe --maintenance-migrate $root app-2.0.0 2147483647
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $marker = Join-Path $root $(if ($scenario -eq 'success') { '.codex-migrated' } else { '.codex-migration-failed' })
    while (-not (Test-Path -LiteralPath $marker) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
    if (-not (Test-Path -LiteralPath $marker)) {
      Get-Content -LiteralPath (Join-Path $root 'CodexInstall.log') -ErrorAction SilentlyContinue
      throw "Migration scenario did not finish: $scenario"
    }
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$registryPrefix\Uninstall\Codex")
    $actualLocation = $key.GetValue('InstallLocation'); $key.Close()
    if ($scenario -eq 'success') {
      if ($actualLocation -ne $target) { throw 'Uninstall registration was not migrated' }
      $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$registryPrefix\Classes\codex\shell\open\command")
      $command = $key.GetValue(''); $key.Close()
      if ($command -ne "`"$target\Codex.exe`" `"%1`"") { throw 'Historical portable protocol registration was not repaired' }
      $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$registryPrefix\App Paths\Codex.exe")
      $entry = $key.GetValue(''); $key.Close()
      if ($entry -ne (Join-Path $target 'Codex.exe')) { throw 'App Paths still points outside the current installation' }
      foreach ($file in @('.custom', 'packages\complete.nupkg', 'update-cache\partial', 'app-2.0.0\resources\app.asar')) {
        if ([IO.File]::ReadAllText((Join-Path $root $file)) -ne [IO.File]::ReadAllText((Join-Path $target $file))) { throw "Migration lost $file" }
      }
      $shell = New-Object -ComObject WScript.Shell
      $link = $shell.CreateShortcut($shortcutPath)
      if ($link.TargetPath -ne (Join-Path $target 'Update.exe') -or $link.Arguments -ne '--processStart ChatGPT.exe') { throw 'Startup shortcut was not migrated' }
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) | Out-Null
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null
      $task = Get-ScheduledTask -TaskName $taskName
      if ($task.Actions.Execute -ne (Join-Path $target 'CodexUpdater.exe')) { throw 'Cleanup task points to the wrong installation' }
      $retired = Join-Path $target '.old\0\app-1.0.0'
      $heldExe = Join-Path $retired 'held.exe'
      Copy-Item -LiteralPath $fixtureExe -Destination $heldExe
      $held = Start-Process -FilePath $heldExe -ArgumentList '--hold' -WindowStyle Hidden -PassThru
      Start-Sleep -Milliseconds 200
      $cleanup = Start-Process -FilePath $fixtureExe -ArgumentList @('--age', "`"$target`"") -WindowStyle Hidden -Wait -PassThru
      if ($cleanup.ExitCode -ne 0 -or (Test-Path -LiteralPath $root)) { throw 'Expired legacy root was not removed' }
      if (-not (Test-Path -LiteralPath $heldExe)) { throw 'Cleanup removed a running retired version' }
      $held.Kill(); $held.WaitForExit(); $held.Dispose(); $held = $null
      $cleanup = Start-Process -FilePath $fixtureExe -ArgumentList @('--age', "`"$target`"") -WindowStyle Hidden -Wait -PassThru
      if ($cleanup.ExitCode -ne 0 -or (Test-Path -LiteralPath $retired)) { throw 'Cleanup did not retry after the retired process exited' }
      if (-not (Test-Path -LiteralPath (Join-Path $target 'app-2.0.0\resources\app.asar'))) { throw 'Cleanup removed current resources' }
      # A backup restored after first healthy start still needs an expiration; a removed legacy root stays absent.
      New-Item -ItemType Directory -Path (Join-Path $target 'app-0.5.0') | Out-Null
      $shell = New-Object -ComObject WScript.Shell
      $link = $shell.CreateShortcut($shortcutPath)
      $link.TargetPath = Join-Path $target 'ChatGPT.exe'
      $link.Arguments = ''
      $link.WorkingDirectory = Join-Path $target 'app-1.0.0'
      $link.Save()
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) | Out-Null
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null
      & $fixtureExe --maintenance-confirm $target app-2.0.0
      if ($LASTEXITCODE -ne 0) { throw 'Repeated confirmation failed after legacy root removal' }
      [xml]$state = Get-Content -LiteralPath (Join-Path $target '.codex-install.xml')
      if (@($state.State.Versions.Retired | Where-Object { $_ -and [long]$_.ExpiresUtc -le 0 }).Count -gt 0) { throw 'Late restored backup has no expiry' }
      if (Test-Path -LiteralPath $root) { throw 'Repeated confirmation recreated the removed legacy root' }
      $shell = New-Object -ComObject WScript.Shell
      $link = $shell.CreateShortcut($shortcutPath)
      if ($link.TargetPath -ne (Join-Path $target 'Update.exe') -or $link.WorkingDirectory -ne $target) { throw 'Post-migration update left a shortcut tied to an old version directory' }
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) | Out-Null
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null
    } else {
      if ($actualLocation -ne $root -or -not (Test-Path -LiteralPath (Join-Path $root '.custom'))) { throw 'Failed migration damaged source installation' }
    }
    Write-Output "Windows installation migration scenario passed: $scenario"
  }
} finally {
  if ($held -and -not $held.HasExited) { $held.Kill(); $held.WaitForExit(); $held.Dispose() }
  $env:CODEX_INSTALL_FIXTURE = $savedFixture
  $env:CODEX_INSTALL_FAIL_START = $savedFailure
  Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
  [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($registryPrefix, $false)
  $resolved = [IO.Path]::GetFullPath($temporary)
  if (-not $resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected integration cleanup path' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
