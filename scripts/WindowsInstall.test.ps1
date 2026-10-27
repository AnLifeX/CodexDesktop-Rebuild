$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'WindowsInstall.cs') -Raw
$harness = @'
public static class InstallTests
{
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    private static void Reject(Action action, string message) { try { action(); } catch (IOException) { return; } throw new Exception(message); }

    public static void Run(string temporary)
    {
        string local = Path.Combine(temporary, "local"), root = Path.Combine(local, "Programs", "Codex");
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, "Update.exe"), "updater");
        WindowsInstall.ValidateRoot(root, local);
        Reject(() => WindowsInstall.ValidateRoot(temporary, local), "Outside root accepted");
        Reject(() => WindowsInstall.AppPath(root, "app-1.2.3/../../outside"), "Traversal accepted");
        Reject(() => WindowsInstall.RetiredPath(root, "../outside"), "Outside retired path accepted");
        Reject(() => WindowsInstall.RetiredPath(root, "resources"), "Resources treated as an old version");

        string current = Path.Combine(root, "app-2.0.0"), old = Path.Combine(root, "app-1.0.0");
        Directory.CreateDirectory(Path.Combine(current, "resources"));
        Directory.CreateDirectory(old);
        File.WriteAllText(Path.Combine(current, "resources", "app.asar"), "current resources");
        File.WriteAllText(Path.Combine(current, "ChatGPT.exe"), "current executable");
        File.WriteAllText(Path.Combine(current, "CodexUpdater.exe"), "new rescue updater");
        File.WriteAllText(Path.Combine(root, "CodexUpdater.exe"), "outdated rescue updater");
        File.WriteAllText(Path.Combine(current, "156.0.0.0.manifest"), "current manifest");
        File.WriteAllText(Path.Combine(old, "old.exe"), "retained");
        File.WriteAllText(Path.Combine(root, ".custom-hidden"), "user file");
        Directory.CreateDirectory(Path.Combine(root, "packages", "empty"));
        File.WriteAllText(Path.Combine(root, "packages", "RELEASES"), "package manifest");
        File.WriteAllText(Path.Combine(root, "packages", "custom.nupkg"), "package bytes");
        WindowsInstall.Retain(root, "app-2.0.0");
        Check(File.ReadAllText(Path.Combine(root, "CodexUpdater.exe")) == "new rescue updater", "Root rescue updater stayed outdated");
        Check(File.ReadAllText(Path.Combine(root, "156.0.0.0.manifest")) == "current manifest", "Root launch manifest was missed");
        var state = WindowsInstall.Load(root);
        Check(state.HealthyUtc == 0 && state.Versions.Count == 1, "Retention started before successful launch");
        string retained = WindowsInstall.RetiredPath(root, state.Versions[0].RelativePath);
        Check(File.Exists(Path.Combine(retained, "old.exe")), "Squirrel-safe backup was not retained");
        WindowsInstall.CleanupFiles(root, state, DateTime.UtcNow.AddDays(2).Ticks);
        Check(Directory.Exists(retained), "Unconfirmed update deleted old version");

        string copy = Path.Combine(temporary, "copy");
        WindowsInstall.CopyVerified(root, copy);
        Check(File.ReadAllText(Path.Combine(copy, ".custom-hidden")) == "user file", "Hidden file was missed");
        Check(Directory.Exists(Path.Combine(copy, "packages", "empty")), "Empty directory was missed");
        foreach (string file in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
        {
            string relative = file.Substring(root.Length + 1);
            Check(WindowsInstall.FileHash(file) == WindowsInstall.FileHash(Path.Combine(copy, relative)), "Copied content differs: " + relative);
        }

        long healthy = DateTime.UtcNow.Ticks;
        state.HealthyUtc = healthy;
        state.Versions[0].ExpiresUtc = healthy + WindowsInstall.Retention.Ticks;
        WindowsInstall.Save(root, state);
        WindowsInstall.CleanupFiles(root, state, healthy + TimeSpan.FromHours(23).Ticks);
        Check(Directory.Exists(retained), "Old version removed before 24 hours");
        string newer = Path.Combine(root, "app-3.0.0"); Directory.CreateDirectory(newer);
        WindowsInstall.CleanupFiles(root, state, healthy + TimeSpan.FromHours(24).Ticks);
        Check(!Directory.Exists(retained), "Expired version was not removed");
        Check(Directory.Exists(current) && Directory.Exists(newer), "Current or pending version was removed");
        Check(File.ReadAllText(Path.Combine(root, ".custom-hidden")) == "user file", "Unrelated file removed");

        state.Versions.Add(new WindowsInstall.Retired { RelativePath = "app-2.0.0", ExpiresUtc = healthy });
        Reject(() => WindowsInstall.CleanupFiles(root, state, healthy + 1), "Current version can be retired");
        Check(File.Exists(Path.Combine(current, "resources", "app.asar")), "Current resources damaged");
        Check(WindowsInstall.Quote("C:\\folder with spaces\\") == "\"C:\\folder with spaces\\\\\"", "Trailing slash quoting is wrong");
        Check(WindowsInstall.Quote("a\"b") == "\"a\\\"b\"", "Quote escaping is wrong");
        Check(WindowsInstall.ReplaceRootReference("C:\\Local\\CodexOther\\run.exe", "C:\\Local\\Codex", "C:\\New\\Codex") == "C:\\Local\\CodexOther\\run.exe", "Sibling installation reference was changed");
        Check(WindowsInstall.ReplaceRootReference("\"C:\\Local\\Codex\\run.exe\" --start", "C:\\Local\\Codex", "C:\\New\\Codex") == "\"C:\\New\\Codex\\run.exe\" --start", "Installation reference was not changed");
        Check(WindowsInstall.CompareApps("app-26.1021.31346-rebuild0001", "app-26.1021.31345") > 0, "r1 must sort after official version");
        Check(WindowsInstall.CompareApps("app-26.1021.31346", "app-26.1021.31346-rebuild0001") > 0, "Next official version must sort after r1");
        var before = File.ReadAllText(Path.Combine(root, WindowsInstall.StateFile));
        WindowsInstall.Retain(root, "app-2.0.0");
        WindowsInstall.Confirm(root, "app-2.0.0");
        Check(Directory.Exists(newer), "An old process retired a newer installed version");
        Check(File.ReadAllText(Path.Combine(root, WindowsInstall.StateFile)) == before, "An old process changed installation state");
        Directory.Delete(newer);
        File.WriteAllText(Path.Combine(root, "packages", "RELEASES"), new string('A', 40) + " Codex-2.0.1-rebuild0001.nupkg 123\n");
        WindowsInstall.Retain(root, "app-2.0.0");
        Check(File.ReadAllText(Path.Combine(root, WindowsInstall.StateFile)) == before, "Old process ignored newer manifest version");
    }
}
'@
Add-Type -TypeDefinition ($source + "`n" + $harness)
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('codex-install-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  [InstallTests]::Run($temporary)
  $outside = Join-Path $temporary 'outside'
  $linked = Join-Path $temporary 'linked'
  New-Item -ItemType Directory -Path $outside | Out-Null
  Set-Content -LiteralPath (Join-Path $outside 'sentinel') -Value 'keep'
  New-Item -ItemType Junction -Path $linked -Target $outside | Out-Null
  $method = [WindowsInstall].GetMethod('CopyVerified', [Reflection.BindingFlags]'NonPublic, Static')
  $rejected = $false
  try { $method.Invoke($null, @($linked, (Join-Path $temporary 'junction-copy'))) } catch { $rejected = $true }
  if (-not $rejected -or -not (Test-Path -LiteralPath (Join-Path $outside 'sentinel'))) { throw 'Junction boundary was not protected' }
  Remove-Item -LiteralPath $linked
  $menu = Join-Path $temporary 'menu'
  New-Item -ItemType Directory -Path (Join-Path $menu 'Programs') | Out-Null
  Set-Content -LiteralPath (Join-Path $menu 'Programs\Codex.lnk') -Value 'shortcut'
  Set-Content -LiteralPath (Join-Path $outside 'outside.lnk') -Value 'unrelated'
  $linked = Join-Path $menu '程序'
  New-Item -ItemType Junction -Path $linked -Target $outside | Out-Null
  $enumerate = [WindowsInstall].GetMethod('ShortcutFiles', [Reflection.BindingFlags]'NonPublic, Static')
  $shortcuts = @($enumerate.Invoke($null, [object[]]@([string]$menu)))
  if ($shortcuts.Count -ne 1 -or $shortcuts[0] -ne (Join-Path $menu 'Programs\Codex.lnk')) { throw 'Shortcut scan followed a compatibility junction or missed real Programs' }
  Remove-Item -LiteralPath $linked
  Write-Output 'Windows install: full copy/hash verification, 24-hour boundary, unconfirmed startup, current/pending protection, path traversal, and junction checks passed'
} finally {
  $resolved = [IO.Path]::GetFullPath($temporary)
  if (-not $resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected test cleanup path' }
  if (Test-Path -LiteralPath $linked) { Remove-Item -LiteralPath $linked }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
