using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;

[assembly: AssemblyTitle("Codex Recovery Updater")]
[assembly: AssemblyProduct("Codex Desktop Rebuild")]
[assembly: AssemblyVersion("1.0.0.0")]

internal static class CodexUpdater
{
    private const string DefaultFeed = "https://github.com/anlifex/CodexDesktop-Rebuild/releases/download/windows-update-feed";

    private static int Main(string[] args)
    {
        try
        {
            if (!args.Contains("--temporary"))
            {
                string temporary = Path.Combine(Path.GetTempPath(), "CodexUpdater-recovery-" + Guid.NewGuid().ToString("N") + ".exe");
                File.Copy(Assembly.GetExecutingAssembly().Location, temporary, true);
                Process.Start(new ProcessStartInfo(temporary, "--temporary") { UseShellExecute = true });
                return 0;
            }

            Console.Title = "Codex Recovery Updater";
            string root = FindInstallRoot();
            if (root == null) return Fail("Codex is not installed for the current user.");
            while (IsCodexRunning(root))
            {
                Console.WriteLine("Close Codex, then press Enter to retry. Type F to close it, or Q to quit.");
                string choice = Console.ReadLine();
                if (choice == null || choice.Equals("Q", StringComparison.OrdinalIgnoreCase)) return 1;
                if (choice.Equals("F", StringComparison.OrdinalIgnoreCase)) IsCodexRunning(root, true);
            }

            string feed = Environment.GetEnvironmentVariable("CODEX_REBUILD_UPDATE_URL") ?? DefaultFeed;
            string updateExe = Path.Combine(root, "Update.exe");
            Console.WriteLine("Reading update feed...");
            var packageSizes = ReadPackageSizes(feed);
            string logPath = Path.Combine(root, "Squirrel-Update.log");
            Process existingUpdate = FindRunningUpdater(root);
            long logPosition = File.Exists(logPath) ? new FileInfo(logPath).Length : 0;
            if (existingUpdate != null) logPosition = Math.Max(0, logPosition - 65536);
            string pendingLog = "";
            Console.WriteLine(existingUpdate == null ? "Checking for updates..." :
                "Monitoring existing update (PID " + existingUpdate.Id + ")...");
            IntPtr job = CreateKillOnCloseJob();
            try
            {
                using (Process update = existingUpdate ?? Process.Start(new ProcessStartInfo(updateExe, "--update=" + feed)
                {
                    UseShellExecute = false,
                }))
                {
                if (!AssignProcessToJobObject(job, update.Handle))
                {
                    if (existingUpdate == null && !update.HasExited) update.Kill();
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Could not bind Update.exe to the updater window");
                }
                var packages = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                string stage = "Checking for updates";
                long reportedBytes = -1;
                int reportedPercent = -1;
                int progressWidth = 0;
                string lastDownloadError = null;
                do
                {
                    foreach (string line in ReadNewLogLines(logPath, ref logPosition, ref pendingLog))
                    {
                        const string downloading = "FileDownloader: Downloading file: ";
                        const string repacking = "DeltaPackageBuilder: Repacking into full package: ";
                        if (line.Contains(downloading))
                        {
                            string url = line.Substring(line.IndexOf(downloading) + downloading.Length).Trim();
                            string package = Path.GetFileName(new Uri(url).LocalPath);
                            packages.Add(package);
                            stage = "Downloading update packages";
                            reportedBytes = -1;
                            reportedPercent = -1;
                            if (progressWidth > 0) { Console.WriteLine(); progressWidth = 0; }
                            Console.WriteLine("Downloading " + package);
                        }
                        else if (line.Contains(repacking))
                        {
                            packages.Clear();
                            stage = "Applying delta package";
                            if (progressWidth > 0) { Console.WriteLine(); progressWidth = 0; }
                            Console.WriteLine(stage + " (this can take several minutes)...");
                        }
                        else if (line.Contains("ApplyReleasesImpl: Writing files to app directory"))
                        {
                            packages.Clear();
                            stage = "Installing application files";
                            if (progressWidth > 0) { Console.WriteLine(); progressWidth = 0; }
                            Console.WriteLine(stage + "...");
                        }
                        else if (line.Contains("falling back to full updates"))
                        {
                            packages.Clear();
                            if (progressWidth > 0) { Console.WriteLine(); progressWidth = 0; }
                            Console.WriteLine("Delta download failed; trying the full package...");
                        }
                        if (line.Contains("Failed downloading URL:"))
                            lastDownloadError = line.Substring(line.IndexOf("Failed downloading URL:"));
                    }

                    if (packages.Count > 0)
                    {
                        long bytes = 0, total = 0;
                        bool sizesKnown = true;
                        foreach (string package in packages)
                        {
                            string packagePath = Path.Combine(root, "packages", package);
                            if (File.Exists(packagePath)) bytes += new FileInfo(packagePath).Length;
                            long size;
                            if (packageSizes.TryGetValue(package, out size) && size > 0) total += size;
                            else sizesKnown = false;
                        }
                        int percent = sizesKnown ? (int)Math.Min(100, bytes * 100 / total) : -1;
                        if (!Console.IsOutputRedirected && (bytes != reportedBytes || progressWidth == 0))
                        {
                            string progress = FormatProgress(bytes, sizesKnown ? total : 0);
                            Console.Write("\r" + progress.PadRight(progressWidth));
                            progressWidth = progress.Length;
                        }
                        else if (Console.IsOutputRedirected &&
                            (percent >= 0 && (reportedPercent < 0 || percent / 10 > reportedPercent / 10 || percent == 100 && reportedPercent != 100)
                             || percent < 0 && (reportedBytes < 0 || bytes / 10485760 > reportedBytes / 10485760)))
                            Console.WriteLine(FormatProgress(bytes, sizesKnown ? total : 0));
                        reportedBytes = bytes;
                        reportedPercent = percent;
                    }
                } while (!update.WaitForExit(1000));
                if (progressWidth > 0) Console.WriteLine();
                if (update.ExitCode != 0) return Fail("Update.exe failed with exit code " + update.ExitCode +
                    (lastDownloadError == null ? ". See " + logPath : ": " + lastDownloadError));
                }
            }
            finally { CloseHandle(job); }
            Console.WriteLine("Update completed.");

            string appExe = Directory.GetDirectories(root, "app-*")
                .SelectMany(directory => new[] { "ChatGPT.exe", "Codex.exe" }
                    .Select(name => Path.Combine(directory, name)))
                .Where(File.Exists)
                .OrderByDescending(File.GetLastWriteTimeUtc)
                .FirstOrDefault();
            if (appExe != null) Process.Start(new ProcessStartInfo(appExe) { UseShellExecute = true });
            return 0;
        }
        catch (Exception error)
        {
            return Fail(error.Message);
        }
    }

    private static string FindInstallRoot()
    {
        string directory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        for (int depth = 0; depth < 3 && directory != null; depth++, directory = Path.GetDirectoryName(directory))
            if (File.Exists(Path.Combine(directory, "Update.exe"))) return directory;
        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Codex");
        return File.Exists(Path.Combine(root, "Update.exe")) ? root : null;
    }

    private static bool IsInstalledCodexPath(string root, string executable)
    {
        string installRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        string path = Path.GetFullPath(executable);
        return (string.Equals(Path.GetDirectoryName(path), installRoot, StringComparison.OrdinalIgnoreCase)
                && (string.Equals(Path.GetFileName(path), "ChatGPT.exe", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(Path.GetFileName(path), "Codex.exe", StringComparison.OrdinalIgnoreCase)))
            || path.StartsWith(installRoot + Path.DirectorySeparatorChar + "app-", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsCodexRunning(string root, bool forceClose = false)
    {
        bool running = false;
        foreach (Process process in Process.GetProcesses())
            using (process)
            {
                string executable;
                try { executable = process.MainModule.FileName; }
                catch (InvalidOperationException) { continue; }
                catch (System.ComponentModel.Win32Exception) { continue; }
                if (!IsInstalledCodexPath(root, executable)) continue;
                Console.WriteLine("{0} PID {1}: {2}", forceClose ? "Closing" : "Running", process.Id, executable);
                if (forceClose)
                {
                    try
                    {
                        process.Kill();
                        if (process.WaitForExit(5000)) Console.WriteLine("Closed PID " + process.Id);
                    }
                    catch (Exception error) { Console.Error.WriteLine("Could not close " + executable + ": " + error.Message); }
                }
                if (!process.HasExited) running = true;
            }
        return running;
    }

    private static bool IsInstalledUpdaterPath(string root, string executable)
    {
        return string.Equals(Path.GetFullPath(executable), Path.Combine(Path.GetFullPath(root), "Update.exe"),
            StringComparison.OrdinalIgnoreCase);
    }

    private static Process FindRunningUpdater(string root)
    {
        foreach (Process process in Process.GetProcessesByName("Update"))
        {
            try
            {
                if (!process.HasExited && IsInstalledUpdaterPath(root, process.MainModule.FileName)) return process;
            }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
            process.Dispose();
        }
        return null;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobLimits
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JobLimits limits, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static IntPtr CreateKillOnCloseJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        var limits = new JobLimits { LimitFlags = 0x2000 }; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(JobLimits))))
        {
            int error = Marshal.GetLastWin32Error();
            CloseHandle(job);
            throw new System.ComponentModel.Win32Exception(error);
        }
        return job;
    }

    // The shipped updater targets .NET Framework, where HttpWebRequest is available without extra assemblies.
#pragma warning disable
    private static Dictionary<string, long> ReadPackageSizes(string feed)
    {
        try
        {
            ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
            var request = (HttpWebRequest)WebRequest.Create(feed.TrimEnd('/') + "/RELEASES");
            request.Timeout = 10000;
            request.ReadWriteTimeout = 10000;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
                return ParsePackageSizes(reader.ReadToEnd());
        }
        catch (Exception error)
        {
            Console.WriteLine("Package size unavailable: " + error.Message);
            return new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        }
    }
#pragma warning restore

    private static Dictionary<string, long> ParsePackageSizes(string releases)
    {
        var sizes = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        foreach (string line in releases.Split('\n'))
        {
            string[] parts = line.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            long size;
            if (parts.Length >= 3 && long.TryParse(parts[2], out size)) sizes[parts[1]] = size;
        }
        return sizes;
    }

    private static string FormatProgress(long bytes, long total)
    {
        if (total <= 0) return string.Format("Downloaded {0:F1} MB", bytes / 1048576.0);
        int percent = (int)Math.Min(100, bytes * 100 / total);
        int filled = percent * 30 / 100;
        return string.Format("Downloading [{0}{1}] {2}% ({3:F1}/{4:F1} MB)",
            new string('#', filled), new string('-', 30 - filled), percent,
            bytes / 1048576.0, total / 1048576.0);
    }

    private static string[] ReadNewLogLines(string path, ref long position, ref string pending)
    {
        if (!File.Exists(path)) return new string[0];
        try
        {
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                if (stream.Length < position) { position = 0; pending = ""; }
                stream.Position = position;
                using (var reader = new StreamReader(stream))
                {
                    string content = pending + reader.ReadToEnd();
                    position = stream.Position;
                    int lastNewline = content.LastIndexOf('\n');
                    if (lastNewline < 0) { pending = content; return new string[0]; }
                    pending = content.Substring(lastNewline + 1);
                    return content.Substring(0, lastNewline).Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries);
                }
            }
        }
        catch (IOException) { return new string[0]; }
    }

    private static int Fail(string message)
    {
        Console.Error.WriteLine("Codex update failed: " + message);
        Console.Error.WriteLine("Press Enter to close.");
        Console.ReadLine();
        return 1;
    }
}
