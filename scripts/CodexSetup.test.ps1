$ErrorActionPreference = 'Stop'
$testId = [guid]::NewGuid().ToString('N')
$packageName = "CodexFixture$testId"
$temporary = Join-Path ([IO.Path]::GetTempPath()) "codex-setup-tests-$testId"
$local = Join-Path $temporary 'local'
$target = Join-Path $local "Programs\$packageName"
$registryPath = "Software\Microsoft\Windows\CurrentVersion\Uninstall\$packageName"
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$vendor = Join-Path $PSScriptRoot '..\node_modules\electron-winstaller\vendor'
New-Item -ItemType Directory -Path $temporary | Out-Null
$savedFixture = $env:CODEX_SETUP_FIXTURE
$env:CODEX_SETUP_FIXTURE = $local
try {
  $app = Join-Path $temporary 'app'
  $feed = Join-Path $temporary 'feed'
  New-Item -ItemType Directory -Path $app, $feed | Out-Null
  $stubSource = Join-Path $temporary 'stub.cs'
  @'
using System;
using System.IO;
using System.Reflection;
using System.Linq;
public class Stub
{
    public static int Main(string[] args)
    {
        if (args.Any(arg => arg.StartsWith("--squirrel-"))) return 0;
        File.WriteAllText(Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "launched.txt"), "started");
        return 0;
    }
}
'@ | Set-Content -LiteralPath $stubSource
  $stubExe = Join-Path $app 'Codex.exe'
  & $compiler /nologo /target:winexe "/out:$stubExe" $stubSource
  if ($LASTEXITCODE -ne 0) { throw 'Stub compilation failed' }
  Copy-Item -LiteralPath $stubExe -Destination (Join-Path $app 'ChatGPT.exe')
  @'
const fs=require('fs'),r=require('resedit'),file=process.argv[2];
const exe=r.NtExecutable.from(fs.readFileSync(file));
const resources=r.NtExecutableResource.from(exe);
const version=r.Resource.VersionInfo.createEmpty();
version.setStringValue({lang:1033,codepage:1200},'SquirrelAwareVersion','1');
version.outputToResourceEntries(resources.entries);
resources.outputResource(exe);
fs.writeFileSync(file,Buffer.from(exe.generate()));
'@ | node - (Join-Path $app 'ChatGPT.exe')
  if ($LASTEXITCODE -ne 0) { throw 'Could not mark the official-name executable Squirrel-aware' }
  $setupSource = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'CodexSetup.cs') -Raw).Replace('"Codex"', "`"$packageName`"").Replace('^Codex-', "^$packageName-")
  $setupSource += @'
public class SetupTestEntry
{
    public static int Main()
    {
        try { CodexSetup.Install(message => Console.WriteLine(message)); return 0; }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
'@
  $setupSource = $setupSource.Replace('Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)', 'Environment.GetEnvironmentVariable("CODEX_SETUP_FIXTURE")')
  $setupFile = Join-Path $temporary 'setup.cs'
  [IO.File]::WriteAllText($setupFile, $setupSource)
  foreach ($version in @('1.0.0', '2.0.0')) {
    [IO.File]::WriteAllText((Join-Path $app 'version.txt'), $version)
    $nuspec = Join-Path $temporary "$packageName.nuspec"
    $xml = "<package><metadata><id>$packageName</id><version>$version</version><authors>Codex tests</authors><description>Installer fixture</description></metadata><files><file src=`"$app\**`" target=`"lib\net45`"/></files></package>"
    [IO.File]::WriteAllText($nuspec, $xml)
    & (Join-Path $vendor 'nuget.exe') pack $nuspec -OutputDirectory $temporary -NoDefaultExcludes | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture package failed' }
    & (Join-Path $vendor 'Squirrel.exe') --releasify (Join-Path $temporary "$packageName.$version.nupkg") --releaseDir $feed --no-msi --no-delta | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture release failed' }
    $line = Get-Content -LiteralPath (Join-Path $feed 'RELEASES') | Where-Object { $_ -match " $packageName-$version-full.nupkg " }
    $manifest = Join-Path $temporary 'RELEASES'
    [IO.File]::WriteAllText($manifest, "$line`n", [Text.UTF8Encoding]::new($false))
    $setupExe = Join-Path $temporary "setup-$version.exe"
    $update = Join-Path $vendor 'Squirrel.exe'
    & $compiler /nologo /target:exe /main:SetupTestEntry /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/out:$setupExe" "/resource:$manifest,CodexReleases" "/resource:$update,SquirrelUpdate" $setupFile (Join-Path $PSScriptRoot 'WindowsInstall.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Setup fixture compilation failed' }
    $offset = (Get-Item -LiteralPath $setupExe).Length
    $packagePath = Join-Path $feed "$packageName-$version-full.nupkg"
    $output = [IO.File]::Open($setupExe, [IO.FileMode]::Append)
    $input = [IO.File]::OpenRead($packagePath)
    try {
      $input.CopyTo($output)
      $footer = [IO.BinaryWriter]::new($output)
      $footer.Write([Text.Encoding]::ASCII.GetBytes('CDXSETUP'))
      $footer.Write([long]$offset)
      $footer.Write([long]$input.Length)
      $footer.Flush()
    } finally { $input.Dispose(); $output.Dispose() }
    $install = Start-Process -FilePath $setupExe -WindowStyle Hidden -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "Installer returned $($install.ExitCode) for $version" }
    $appRoot = Join-Path $target "app-$version"
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath (Join-Path $appRoot 'launched.txt')) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'launched.txt'))) { throw 'Fixed-entry launch did not reach installed app' }
    if ([IO.File]::ReadAllText((Join-Path $appRoot 'version.txt')) -ne $version) { throw 'Incorrect app payload installed' }
    if ($version -eq '1.0.0') { [IO.File]::WriteAllText((Join-Path $target 'custom.txt'), 'preserve installation files') }
    else {
      if ([IO.File]::ReadAllText((Join-Path $target 'custom.txt')) -ne 'preserve installation files') { throw 'Setup deleted existing root contents' }
      if (-not (Test-Path -LiteralPath (Join-Path $target 'app-1.0.0\version.txt'))) { throw 'Setup deleted previous application version' }
    }
    Write-Output "Real Squirrel installer passed: $version (fresh install or upgrade, Programs path, fixed entry, and preserved files)"
  }
} finally {
  $env:CODEX_SETUP_FIXTURE = $savedFixture
  [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($registryPath, $false)
  $resolved = [IO.Path]::GetFullPath($temporary)
  if (-not $resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected installer test cleanup path' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
