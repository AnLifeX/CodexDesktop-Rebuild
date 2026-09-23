using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;

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
                string temporary = Path.Combine(Path.GetTempPath(), "CodexUpdater-recovery.exe");
                File.Copy(Assembly.GetExecutingAssembly().Location, temporary, true);
                Process.Start(new ProcessStartInfo(temporary, "--temporary") { UseShellExecute = true });
                return 0;
            }

            Console.Title = "Codex Recovery Updater";
            string root = FindInstallRoot();
            if (root == null) return Fail("Codex is not installed for the current user.");
            if (IsCodexRunning())
            {
                Console.WriteLine("Close Codex, then press Enter to continue.");
                Console.ReadLine();
                if (IsCodexRunning()) return Fail("Codex is still running.");
            }

            string feed = Environment.GetEnvironmentVariable("CODEX_REBUILD_UPDATE_URL") ?? DefaultFeed;
            string updateExe = Path.Combine(root, "Update.exe");
            Console.WriteLine("Checking and installing the latest Codex update...");
            using (Process update = Process.Start(new ProcessStartInfo(updateExe, "--update=" + feed)
            {
                UseShellExecute = false,
            }))
            {
                update.WaitForExit();
                if (update.ExitCode != 0) return Fail("Update.exe failed with exit code " + update.ExitCode + ".");
            }

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

    private static bool IsCodexRunning()
    {
        return Process.GetProcessesByName("ChatGPT").Length > 0 || Process.GetProcessesByName("Codex").Length > 0;
    }

    private static int Fail(string message)
    {
        Console.Error.WriteLine("Codex update failed: " + message);
        Console.Error.WriteLine("Press Enter to close.");
        Console.ReadLine();
        return 1;
    }
}
