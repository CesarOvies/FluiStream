using System;
#if WINDOWS
using System.Windows.Forms;
#else
using System.Threading.Tasks;
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
    private static async Task Main(string[] args)
    {
        await CrossPlatformHost.RunAsync(args);
    }
#endif
}
