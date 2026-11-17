using System;
#if WINDOWS
using System.Windows.Forms;
#endif

namespace FluiStream.Desktop;

internal static class Program
{
#if WINDOWS
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.Run(new MainForm());
    }
#else
    [STAThread]
    private static void Main(string[] args)
    {
        CrossPlatformHost.Run(args);
    }
#endif
}
