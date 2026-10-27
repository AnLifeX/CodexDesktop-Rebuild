using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Xml;
using System.Xml.Serialization;
using Microsoft.Win32;

// Runs outside Electron so migration and delayed cleanup survive the app exiting.
public static class WindowsInstall
{
    internal const string StateFile = ".codex-install.xml";
    internal const string TaskName = "Codex retired versions";
    internal static readonly TimeSpan Retention = TimeSpan.FromHours(24);

    public sealed class Retired
    {
        public string RelativePath;
        public long ExpiresUtc;
    }

    public sealed class State
    {
        public string CurrentApp;
        public long HealthyUtc;
        public string LegacyRoot;
        public bool MigrationCommitted;
        public List<Retired> Versions = new List<Retired>();
    }

    internal static int Run(string[] args)
    {
        string root = null;
        try
        {
            if (args.Length < 2) throw new ArgumentException("Missing installation directory.");
            root = Path.GetFullPath(args[1]);
            ValidateRoot(root, Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));
            if (args[0] == "--maintenance-migrate")
            {
                if (args.Length < 4) throw new ArgumentException("Invalid migration arguments.");
                // The installed helper must be free to move with the rest of the installation.
                if (IsInside(root, Assembly.GetExecutingAssembly().Location))
                {
                    string temporary = Path.Combine(Path.GetTempPath(), "CodexInstall-" + Guid.NewGuid().ToString("N") + ".exe");
                    File.Copy(Assembly.GetExecutingAssembly().Location, temporary);
                    Start(temporary, args);
                    return 0;
                }
                Migrate(root, args[2], int.Parse(args[3]), args.Skip(4).ToArray());
            }
            else
            {
                using (var mutex = new Mutex(false, "Local\\CodexInstall-" + HashText(root.ToUpperInvariant())))
                {
                    if (!mutex.WaitOne(TimeSpan.FromSeconds(20))) throw new IOException("Installation maintenance is busy.");
                    try
                    {
                        if (args[0] == "--maintenance-retain" && args.Length == 3) Retain(root, args[2]);
                        else if (args[0] == "--maintenance-confirm" && args.Length == 3) Confirm(root, args[2]);
                        else if (args[0] == "--maintenance-cleanup" && args.Length == 2) Cleanup(root, DateTime.UtcNow.Ticks);
                        else if (args[0] == "--maintenance-uninstall" && args.Length == 2)
                            RunCommand(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "schtasks.exe"), new[] { "/Delete", "/TN", TaskName, "/F" }, false);
                        else throw new ArgumentException("Unknown installation maintenance command.");
                    }
                    finally { mutex.ReleaseMutex(); }
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            if (root != null && Directory.Exists(root))
                try { File.AppendAllText(Path.Combine(root, "CodexInstall.log"), DateTime.UtcNow.ToString("o") + " " + error + Environment.NewLine); } catch { }
            return 1;
        }
    }

    internal static bool SamePath(string left, string right)
    {
        return string.Equals(Path.GetFullPath(left).TrimEnd('\\', '/'), Path.GetFullPath(right).TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase);
    }

    internal static bool IsInside(string root, string path)
    {
        return Path.GetFullPath(path).StartsWith(Path.GetFullPath(root).TrimEnd('\\', '/') + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    internal static void ValidateRoot(string root, string local)
    {
        if (!SamePath(root, Path.Combine(local, "Codex")) && !SamePath(root, Path.Combine(local, "Programs", "Codex")))
            throw new IOException("Unrecognized Codex installation directory.");
        EnsureNoReparse(root);
        if (!File.Exists(Path.Combine(root, "Update.exe"))) throw new IOException("Missing Squirrel updater.");
    }

    internal static string AppPath(string root, string name)
    {
        if (string.IsNullOrEmpty(name) || !System.Text.RegularExpressions.Regex.IsMatch(name, @"^app-\d+\.\d+\.\d+(?:-r\d+|-rebuild\d+)?$"))
            throw new IOException("Invalid application version directory.");
        string result = Path.Combine(root, name);
        EnsureNoReparse(result);
        return result;
    }

    internal static void EnsureNoReparse(string path)
    {
        for (string current = Path.GetFullPath(path); current != null; current = Path.GetDirectoryName(current))
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("Installation path contains a symbolic link or junction: " + current);
    }

    internal static State Load(string root)
    {
        string file = Path.Combine(root, StateFile);
        if (!File.Exists(file)) return new State();
        using (var reader = XmlReader.Create(file, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null }))
            return (State)new XmlSerializer(typeof(State)).Deserialize(reader);
    }

    internal static void Save(string root, State state)
    {
        string file = Path.Combine(root, StateFile), temporary = file + ".tmp";
        using (var writer = new StreamWriter(temporary, false, new UTF8Encoding(false))) new XmlSerializer(typeof(State)).Serialize(writer, state);
        if (File.Exists(file)) File.Replace(temporary, file, null); else File.Move(temporary, file);
    }

    internal static bool RunningInside(string directory)
    {
        foreach (var process in Process.GetProcesses()) using (process)
        {
            if (process.Id == Process.GetCurrentProcess().Id) continue;
            try { if (IsInside(directory, process.MainModule.FileName)) return true; }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
        }
        return false;
    }

    internal static void Retain(string root, string current)
    {
        AppPath(root, current);
        SyncRootFiles(root, current);
        State state = Load(root);
        if (state.CurrentApp != current) { state.CurrentApp = current; state.HealthyUtc = 0; }
        foreach (string directory in Directory.GetDirectories(root, "app-*"))
        {
            string name = Path.GetFileName(directory);
            if (name == current) continue;
            AppPath(root, name);
            Retired retired = state.Versions.FirstOrDefault(item => item.RelativePath == name);
            if (retired == null) { retired = new Retired { RelativePath = name }; state.Versions.Add(retired); }
            // Squirrel removes versions older than the previous release during apply.
            // Move inactive versions out of its scan before that cleanup runs.
            if (!RunningInside(directory))
            {
                int slot = 0;
                string relative;
                do { relative = Path.Combine(".old", (slot++).ToString(), name); }
                while (Directory.Exists(Path.Combine(root, relative)));
                string target = Path.Combine(root, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                retired.RelativePath = relative;
                Save(root, state);
                try { Directory.Move(directory, target); }
                catch (IOException) { retired.RelativePath = name; }
            }
            Save(root, state);
        }
        Save(root, state);
    }

    internal static void Confirm(string root, string current)
    {
        string directory = AppPath(root, current);
        if (!File.Exists(Path.Combine(directory, "resources", "app.asar"))) throw new IOException("Application resources are incomplete.");
        State state = Load(root);
        if (state.CurrentApp != null && state.CurrentApp != current) return;
        Retain(root, current);
        state = Load(root);
        if (state.HealthyUtc == 0)
        {
            state.HealthyUtc = DateTime.UtcNow.Ticks;
            foreach (var retired in state.Versions) if (retired.ExpiresUtc == 0) retired.ExpiresUtc = state.HealthyUtc + Retention.Ticks;
        }
        if (!string.IsNullOrEmpty(state.LegacyRoot) && !state.MigrationCommitted)
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (!SamePath(root, Path.Combine(local, "Programs", "Codex")) || !SamePath(state.LegacyRoot, Path.Combine(local, "Codex")))
                throw new IOException("Migration source is invalid.");
            UpdateReferences(state.LegacyRoot, root);
        }
        EnsureFixedShortcuts(root, current);
        if (!string.IsNullOrEmpty(state.LegacyRoot))
        {
            File.WriteAllText(Path.Combine(state.LegacyRoot, ".codex-migrated"), root);
            state.MigrationCommitted = true;
        }
        Save(root, state);
        try { ScheduleCleanup(root, state); }
        catch (Exception error) { File.AppendAllText(Path.Combine(root, "CodexInstall.log"), "Cleanup scheduling failed; will retry on launch: " + error.Message + Environment.NewLine); }
        Cleanup(root, DateTime.UtcNow.Ticks);
    }

    internal static void Migrate(string source, string current, int parentPid, string[] appArguments)
    {
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (!SamePath(source, Path.Combine(local, "Codex"))) throw new IOException("Only the legacy installation can migrate.");
        string target = Path.Combine(local, "Programs", "Codex"), staging = target + ".migrating";
        string sourceApp = AppPath(source, current);
        using (var migrationLock = new Mutex(false, "Local\\CodexInstallMigration"))
        {
            if (!migrationLock.WaitOne(0)) return;
            bool staged = false, published = false;
            try
            {
                try { using (var parent = Process.GetProcessById(parentPid)) if (!parent.WaitForExit(60000)) throw new IOException("Codex did not exit for migration."); }
                catch (ArgumentException) { }
                DateTime deadline = DateTime.UtcNow.AddSeconds(60);
                while (RunningInside(source) && DateTime.UtcNow < deadline) Thread.Sleep(500);
                if (RunningInside(source)) throw new IOException("Installation files are still in use.");
                EnsureNoReparse(target);
                if (Directory.Exists(target) || Directory.Exists(staging)) throw new IOException("Migration destination already exists; the old installation was preserved.");
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (var sourceLock = new Mutex(false, "Local\\CodexInstall-" + HashText(source.ToUpperInvariant())))
                {
                    if (!sourceLock.WaitOne(TimeSpan.FromSeconds(30))) throw new IOException("Source installation maintenance is busy.");
                    try { Retain(source, current); staged = true; CopyVerified(source, staging); }
                    finally { sourceLock.ReleaseMutex(); }
                }
                ValidatePayload(staging, current);
                State state = Load(staging);
                state.CurrentApp = current;
                state.HealthyUtc = 0;
                state.LegacyRoot = source;
                state.MigrationCommitted = false;
                Save(staging, state);
                Directory.Move(staging, target);
                published = true;
                string exeName = File.Exists(Path.Combine(target, current, "ChatGPT.exe")) ? "ChatGPT.exe" : "Codex.exe";
                using (var app = Start(Path.Combine(target, current, exeName), appArguments))
                {
                    deadline = DateTime.UtcNow.AddMinutes(10);
                    while (DateTime.UtcNow < deadline)
                    {
                        State confirmation = Load(target);
                        if (confirmation.MigrationCommitted && confirmation.HealthyUtc > 0) return;
                        if (app.HasExited) break;
                        Thread.Sleep(500);
                    }
                }
                throw new IOException("The migrated application did not confirm a successful start; source files were preserved.");
            }
            catch
            {
                // A failed first launch must not leave two apps sharing the same user data.
                if (published && !Load(target).MigrationCommitted)
                {
                    foreach (var process in Process.GetProcesses()) using (process)
                        try { if (IsInside(target, process.MainModule.FileName)) { process.Kill(); process.WaitForExit(5000); } }
                        catch (InvalidOperationException) { }
                        catch (System.ComponentModel.Win32Exception) { }
                    try { UpdateReferences(target, source); } catch { }
                    File.Delete(Path.Combine(source, ".codex-migrated"));
                    Directory.Move(target, target + ".failed-" + Guid.NewGuid().ToString("N"));
                }
                else if (staged && Directory.Exists(staging)) DeleteTree(staging);
                File.WriteAllText(Path.Combine(source, ".codex-migration-failed"), current);
                // No source files are removed before the destination confirms health.
                var fallback = new ProcessStartInfo(Path.Combine(sourceApp, File.Exists(Path.Combine(sourceApp, "ChatGPT.exe")) ? "ChatGPT.exe" : "Codex.exe"), string.Join(" ", appArguments.Select(Quote)));
                fallback.UseShellExecute = false;
                fallback.EnvironmentVariables["CODEX_REBUILD_SKIP_MIGRATION"] = "1";
                Process.Start(fallback);
                throw;
            }
            finally { migrationLock.ReleaseMutex(); }
        }
    }

    internal static void ValidatePayload(string root, string current)
    {
        string app = AppPath(root, current);
        foreach (string file in new[] { "Update.exe", "Codex.exe", "ChatGPT.exe", "CodexUpdater.exe", Path.Combine("packages", "RELEASES"), Path.Combine(current, "resources", "app.asar") })
            if (!File.Exists(Path.Combine(root, file))) throw new IOException("Migration is missing " + file);
        if (!File.Exists(Path.Combine(app, "ChatGPT.exe")) && !File.Exists(Path.Combine(app, "Codex.exe"))) throw new IOException("Missing main executable.");
    }

    internal static void CopyVerified(string source, string target)
    {
        EnsureNoReparse(source);
        Directory.CreateDirectory(target);
        foreach (string directory in Directory.GetDirectories(source))
        {
            EnsureNoReparse(directory);
            CopyVerified(directory, Path.Combine(target, Path.GetFileName(directory)));
        }
        foreach (string file in Directory.GetFiles(source))
        {
            EnsureNoReparse(file);
            string destination = Path.Combine(target, Path.GetFileName(file));
            File.Copy(file, destination, false);
            if (new FileInfo(file).Length != new FileInfo(destination).Length || FileHash(file) != FileHash(destination))
                throw new IOException("Migration verification failed: " + file);
        }
    }

    internal static string FileHash(string file)
    {
        using (var hash = SHA256.Create()) using (var stream = File.OpenRead(file)) return BitConverter.ToString(hash.ComputeHash(stream));
    }

    internal static string HashText(string value)
    {
        using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").Substring(0, 20);
    }

    internal static string RetiredPath(string root, string relative)
    {
        if (string.IsNullOrEmpty(relative) || Path.IsPathRooted(relative)) throw new IOException("Invalid retired directory.");
        string full = Path.GetFullPath(Path.Combine(root, relative));
        if (!IsInside(root, full)) throw new IOException("Retired directory is outside the installation.");
        string name = Path.GetFileName(full);
        if (!SamePath(full, AppPath(root, name)) && !IsInside(Path.Combine(root, ".old"), full)) throw new IOException("Unrecognized retired directory.");
        EnsureNoReparse(full);
        return full;
    }

    internal static void Cleanup(string root, long now)
    {
        State state = Load(root);
        CleanupFiles(root, state, now);
        Save(root, state);
        if (state.HealthyUtc > 0 && state.Versions.Count == 0 && string.IsNullOrEmpty(state.LegacyRoot))
            RunCommand(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "schtasks.exe"), new[] { "/Delete", "/TN", TaskName, "/F" }, false);
    }

    internal static void CleanupFiles(string root, State state, long now)
    {
        if (state.HealthyUtc <= 0 || state.HealthyUtc > now) return;
        string current = AppPath(root, state.CurrentApp);
        if (!File.Exists(Path.Combine(current, "resources", "app.asar")) ||
            !File.Exists(Path.Combine(current, "ChatGPT.exe")) && !File.Exists(Path.Combine(current, "Codex.exe")))
            throw new IOException("Current application is missing; all retained versions were preserved.");
        foreach (Retired retired in state.Versions.ToArray())
        {
            if (retired.ExpiresUtc <= 0 || retired.ExpiresUtc > now) continue;
            string path = RetiredPath(root, retired.RelativePath);
            if (SamePath(path, current)) throw new IOException("Refusing to remove the current version.");
            if (RunningInside(path)) continue;
            try { DeleteTree(path); state.Versions.Remove(retired); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
        if (state.MigrationCommitted && !string.IsNullOrEmpty(state.LegacyRoot) && now >= state.HealthyUtc + Retention.Ticks)
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (!SamePath(root, Path.Combine(local, "Programs", "Codex")) || !SamePath(state.LegacyRoot, Path.Combine(local, "Codex"))) throw new IOException("Invalid legacy cleanup path.");
            if (!RunningInside(state.LegacyRoot))
                try { DeleteTree(state.LegacyRoot); state.LegacyRoot = null; } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    internal static void DeleteTree(string directory)
    {
        if (!Directory.Exists(directory)) return;
        EnsureNoReparse(directory);
        foreach (string child in Directory.GetDirectories(directory)) DeleteTree(child);
        foreach (string file in Directory.GetFiles(directory))
        {
            EnsureNoReparse(file);
            File.SetAttributes(file, File.GetAttributes(file) & ~FileAttributes.ReadOnly);
            File.Delete(file);
        }
        Directory.Delete(directory);
    }

    internal static string Quote(string argument)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in argument)
        {
            if (character == '\\') { slashes++; continue; }
            result.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            result.Append(character);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    internal static Process Start(string exe, string[] args)
    {
        return Process.Start(new ProcessStartInfo(exe, string.Join(" ", args.Select(Quote))) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(exe) });
    }

    internal static void RunCommand(string exe, string[] args, bool required, int timeout = 30000)
    {
        using (var process = Start(exe, args))
        {
            if (!process.WaitForExit(timeout)) { process.Kill(); if (required) throw new IOException("Command timed out: " + exe); }
            else if (required && process.ExitCode != 0) throw new IOException("Command failed: " + exe + " (" + process.ExitCode + ")");
        }
    }

    internal static void ScheduleCleanup(string root, State state)
    {
        var deadlines = state.Versions.Where(item => item.ExpiresUtc > 0).Select(item => item.ExpiresUtc).ToList();
        if (!string.IsNullOrEmpty(state.LegacyRoot)) deadlines.Add(state.HealthyUtc + Retention.Ticks);
        if (deadlines.Count == 0) return;
        DateTime due = new DateTime(Math.Max(DateTime.UtcNow.AddMinutes(1).Ticks, deadlines.Min()), DateTimeKind.Utc);
        string sid = WindowsIdentity.GetCurrent().User.Value;
        var document = new XmlDocument();
        document.LoadXml("<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\"><Triggers><TimeTrigger><Repetition><Interval>PT1H</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary/><Enabled>true</Enabled></TimeTrigger><LogonTrigger><Enabled>true</Enabled><UserId/></LogonTrigger></Triggers><Principals><Principal id=\"Author\"><UserId/><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled><Hidden>true</Hidden><ExecutionTimeLimit>PT15M</ExecutionTimeLimit></Settings><Actions Context=\"Author\"><Exec><Command/><Arguments/></Exec></Actions></Task>");
        var ns = new XmlNamespaceManager(document.NameTable); ns.AddNamespace("t", document.DocumentElement.NamespaceURI);
        document.SelectSingleNode("//t:StartBoundary", ns).InnerText = due.ToString("yyyy-MM-ddTHH:mm:ssZ");
        foreach (XmlNode node in document.SelectNodes("//t:UserId", ns)) node.InnerText = sid;
        document.SelectSingleNode("//t:Command", ns).InnerText = Path.Combine(root, "CodexUpdater.exe");
        document.SelectSingleNode("//t:Arguments", ns).InnerText = "--maintenance-cleanup " + Quote(root);
        string taskFile = Path.Combine(root, ".codex-cleanup-task.xml");
        document.Save(taskFile);
        RunCommand(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "schtasks.exe"), new[] { "/Create", "/TN", TaskName, "/XML", taskFile, "/F" }, true);
    }

    internal static void UpdateReferences(string source, string target)
    {
        foreach (string keyPath in new[] { @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Codex", @"Software\Microsoft\Windows\CurrentVersion\Run", @"Software\Microsoft\Windows\CurrentVersion\RunOnce", @"Software\Classes\codex\shell\open\command", @"Software\Microsoft\Windows\CurrentVersion\App Paths\Codex.exe", @"Software\Microsoft\Windows\CurrentVersion\App Paths\ChatGPT.exe" })
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(keyPath, true))
        {
            if (key == null) continue;
            foreach (string name in key.GetValueNames())
            {
                string value = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
                if (value == null) continue;
                string replaced = ReplaceRootReference(value, source, target);
                if (value != replaced) key.SetValue(name, replaced, key.GetValueKind(name));
            }
            if (keyPath.EndsWith("\\Codex", StringComparison.Ordinal)) key.SetValue("InstallLocation", target);
        }
        foreach (string folder in ShortcutFolders())
        {
            if (!Directory.Exists(folder)) continue;
            foreach (string file in Directory.GetFiles(folder, "*.lnk", SearchOption.AllDirectories))
                EditShortcut(file, source, target, null);
        }
    }

    internal static void SyncRootFiles(string root, string current)
    {
        string app = AppPath(root, current);
        // Squirrel hooks can be skipped by an older bootstrap; ordinary startup repairs these too.
        foreach (string file in Directory.GetFiles(app, "*.manifest").Concat(new[] { Path.Combine(app, "CodexUpdater.exe") }))
        {
            if (!File.Exists(file)) continue;
            string destination = Path.Combine(root, Path.GetFileName(file));
            if (!File.Exists(destination) || FileHash(file) != FileHash(destination)) File.Copy(file, destination, true);
        }
    }

    internal static IEnumerable<string> ShortcutFolders()
    {
        return new[] { Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), Environment.GetFolderPath(Environment.SpecialFolder.Startup), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar") }.Distinct();
    }

    internal static string ReplaceRootReference(string value, string source, string target)
    {
        return System.Text.RegularExpressions.Regex.Replace(value, System.Text.RegularExpressions.Regex.Escape(source) + "(?=[\\\\/\"\\s,]|$)", match => target, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }

    internal static object Invoke(object target, string name, BindingFlags flags, params object[] args)
    {
        return target.GetType().InvokeMember(name, flags, null, target, args);
    }

    internal static void EditShortcut(string file, string source, string target, string current)
    {
        object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")), link = null;
        try
        {
            link = Invoke(shell, "CreateShortcut", BindingFlags.InvokeMethod, file);
            string oldTarget = (string)Invoke(link, "TargetPath", BindingFlags.GetProperty);
            if (current == null && string.IsNullOrWhiteSpace(oldTarget)) return;
            if (current == null && !IsInside(source, oldTarget) && !IsInside(target, oldTarget)) return;
            bool application = new[] { "Codex.exe", "ChatGPT.exe", "Update.exe" }.Contains(Path.GetFileName(oldTarget), StringComparer.OrdinalIgnoreCase);
            Invoke(link, "TargetPath", BindingFlags.SetProperty, current != null || application ? Path.Combine(target, "Update.exe") : ReplaceRootReference(oldTarget, source, target));
            string arguments = (string)Invoke(link, "Arguments", BindingFlags.GetProperty);
            if (current != null || application)
            {
                bool updater = Path.GetFileName(oldTarget).Equals("Update.exe", StringComparison.OrdinalIgnoreCase);
                arguments = updater && arguments.Contains("--processStart") ? arguments :
                    "--processStart ChatGPT.exe" + (string.IsNullOrWhiteSpace(arguments) ? "" : " --process-start-args " + Quote(arguments));
            }
            Invoke(link, "Arguments", BindingFlags.SetProperty, ReplaceRootReference(arguments, source, target));
            Invoke(link, "WorkingDirectory", BindingFlags.SetProperty, target);
            Invoke(link, "IconLocation", BindingFlags.SetProperty, Path.Combine(target, "ChatGPT.exe") + ",0");
            Invoke(link, "Save", BindingFlags.InvokeMethod);
        }
        finally
        {
            if (link != null) System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);
            System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
        }
    }

    internal static void EnsureFixedShortcuts(string root, string current)
    {
        EditShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Codex.lnk"), root, root, current);
        string menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Codex");
        Directory.CreateDirectory(menu);
        EditShortcut(Path.Combine(menu, "Codex.lnk"), root, root, current);
    }
}
