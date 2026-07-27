using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

internal static class CodexGdiCapture
{
    private const uint PwRenderFullContent = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr window, out Rect rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PrintWindow(IntPtr window, IntPtr targetDc, uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 1)
            {
                throw new ArgumentException("Expected one decimal window handle");
            }

            long rawHandle;
            if (!long.TryParse(args[0], out rawHandle) || rawHandle <= 0)
            {
                throw new ArgumentException("Window handle must be a positive integer");
            }

            TryEnablePerMonitorDpiAwareness();
            IntPtr window = new IntPtr(rawHandle);
            if (!IsWindow(window))
            {
                throw new InvalidOperationException("Window handle is no longer valid");
            }

            Rect bounds;
            if (!GetWindowRect(window, out bounds))
            {
                throw new InvalidOperationException("GetWindowRect failed");
            }

            int width = checked(bounds.Right - bounds.Left);
            int height = checked(bounds.Bottom - bounds.Top);
            if (width < 1 || height < 1 || width > 32768 || height > 32768)
            {
                throw new InvalidOperationException("Window has invalid capture bounds");
            }

            using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppRgb))
            {
                bool captured = false;
                if (!IsIconic(window) && GetForegroundWindow() == window)
                {
                    captured = TryCopyFromScreen(bitmap, bounds);
                }
                if (!captured)
                {
                    captured = TryPrintWindow(bitmap, window);
                }
                if (!captured && !IsIconic(window))
                {
                    captured = TryCopyFromScreen(bitmap, bounds);
                }
                if (!captured)
                {
                    throw new InvalidOperationException("PrintWindow and screen capture both failed");
                }

                using (MemoryStream stream = new MemoryStream())
                {
                    bitmap.Save(stream, ImageFormat.Png);
                    string payload = Convert.ToBase64String(stream.ToArray());
                    Console.Out.Write(
                        "{\"url\":\"data:image/png;base64," + payload +
                        "\",\"width\":" + width.ToString() +
                        ",\"height\":" + height.ToString() +
                        ",\"originX\":" + bounds.Left.ToString() +
                        ",\"originY\":" + bounds.Top.ToString() + "}"
                    );
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.Write(error.Message);
            return 2;
        }
    }

    private static bool TryPrintWindow(Bitmap bitmap, IntPtr window)
    {
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.Clear(Color.Black);
            IntPtr targetDc = graphics.GetHdc();
            try
            {
                return PrintWindow(window, targetDc, PwRenderFullContent);
            }
            finally
            {
                graphics.ReleaseHdc(targetDc);
            }
        }
    }

    private static bool TryCopyFromScreen(Bitmap bitmap, Rect bounds)
    {
        try
        {
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                graphics.CopyFromScreen(
                    bounds.Left,
                    bounds.Top,
                    0,
                    0,
                    bitmap.Size,
                    CopyPixelOperation.SourceCopy
                );
            }
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static void TryEnablePerMonitorDpiAwareness()
    {
        try
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
        }
        catch (EntryPointNotFoundException)
        {
        }
        catch (DllNotFoundException)
        {
        }
    }
}
