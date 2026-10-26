using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Codex Setup")]
[assembly: AssemblyProduct("Codex")]
internal static class CodexSetup
{
    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles();
        using (var form = new Form { Text = "Codex 安装", Width = 460, Height = 150, StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false })
        {
            var label = new Label { Text = "正在准备 Codex 安装文件…", AutoSize = true, Left = 24, Top = 20 };
            form.Controls.Add(label);
            form.Controls.Add(new ProgressBar { Left = 24, Top = 55, Width = 390, Style = ProgressBarStyle.Marquee });
            bool completed = false;
            int result = 0;
            form.FormClosing += (sender, e) => { if (!completed) e.Cancel = true; };
            form.Shown += (sender, e) => new Thread(() =>
            {
                try { Install(message => form.BeginInvoke(new Action(() => label.Text = message))); }
                catch (Exception error) { result = 1; MessageBox.Show(error.Message, "Codex 安装失败", MessageBoxButtons.OK, MessageBoxIcon.Error); }
                finally { form.BeginInvoke(new Action(() => { completed = true; form.Close(); })); }
            }) { IsBackground = true }.Start();
            Application.Run(form);
            return result;
        }
    }

    internal static void Install(Action<string> progress)
    {
        string temporary = Path.Combine(Path.GetTempPath(), "CodexSetup-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temporary);
        try
        {
            string releases;
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("CodexReleases"))
            using (var reader = new StreamReader(stream)) releases = reader.ReadToEnd();
            string[] entry = releases.Trim().Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            if (entry.Length != 3 || !System.Text.RegularExpressions.Regex.IsMatch(entry[0], "^[0-9A-Fa-f]{40}$") ||
                !System.Text.RegularExpressions.Regex.IsMatch(entry[1], @"^Codex-\d+\.\d+\.\d+(?:-rebuild\d+)?-full\.nupkg$")) throw new IOException("Invalid embedded release manifest.");
            string package = Path.Combine(temporary, entry[1]);
            using (var input = File.OpenRead(Assembly.GetExecutingAssembly().Location))
            using (var reader = new BinaryReader(input))
            {
                input.Seek(-24, SeekOrigin.End);
                if (Encoding.ASCII.GetString(reader.ReadBytes(8)) != "CDXSETUP") throw new IOException("Installation payload is missing.");
                long offset = reader.ReadInt64(), size = reader.ReadInt64();
                if (offset < 0 || size != long.Parse(entry[2]) || offset + size != input.Length - 24) throw new IOException("Installation payload is incomplete.");
                input.Position = offset;
                using (var output = File.Create(package))
                {
                    var buffer = new byte[1048576];
                    while (size > 0)
                    {
                        int count = input.Read(buffer, 0, (int)Math.Min(buffer.Length, size));
                        if (count == 0) throw new EndOfStreamException();
                        output.Write(buffer, 0, count); size -= count;
                    }
                }
            }
            using (var sha = SHA1.Create()) using (var stream = File.OpenRead(package))
                if (!BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").Equals(entry[0], StringComparison.OrdinalIgnoreCase)) throw new IOException("Installation package checksum does not match.");
            File.WriteAllText(Path.Combine(temporary, "RELEASES"), releases, new UTF8Encoding(false));
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string target = Path.Combine(local, "Programs", "Codex"), legacy = Path.Combine(local, "Codex");
            string root = File.Exists(Path.Combine(target, "Update.exe")) ? target : File.Exists(Path.Combine(legacy, "Update.exe")) ? legacy : target;
            WindowsInstall.EnsureNoReparse(root);
            if (Directory.Exists(root) && !File.Exists(Path.Combine(root, "Update.exe")) && Directory.EnumerateFileSystemEntries(root).Any())
                throw new IOException("安装目标包含未识别的文件，已保留原内容：" + root);
            DateTime exitDeadline = DateTime.UtcNow.AddSeconds(15);
            while (WindowsInstall.RunningInside(root) && DateTime.UtcNow < exitDeadline) Thread.Sleep(500);
            if (WindowsInstall.RunningInside(root)) throw new IOException("请退出 Codex 后重新运行安装程序。已有文件未被修改。");
            Directory.CreateDirectory(root);
            string update = Path.Combine(root, "Update.exe");
            if (!File.Exists(update))
                using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("SquirrelUpdate")) using (var output = File.Create(update)) source.CopyTo(output);
            progress("正在安装 Codex，旧版本将在启动成功后保留 24 小时…");
            // --install deletes the existing root; --update preserves files and version history.
            WindowsInstall.RunCommand(update, new[] { "--update", temporary }, true, 30 * 60 * 1000);
            WindowsInstall.Start(update, new[] { "--processStart", "Codex.exe" });
        }
        finally { try { WindowsInstall.DeleteTree(temporary); } catch { } }
    }
}
