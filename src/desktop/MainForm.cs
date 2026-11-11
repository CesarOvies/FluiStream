using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace FluiStream.Desktop;

public partial class MainForm : Form
{
    private readonly WebView2 _webView;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    public MainForm()
    {
        Text = LocalizationService.Get("AppTitle");
        Size = new Size(1280, 800);
        MinimumSize = new Size(800, 600);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(13, 17, 23); // #0D1117
        ForeColor = Color.FromArgb(230, 237, 243);

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.FromArgb(13, 17, 23)
        };

        Controls.Add(_webView);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Barra de título escura nativa no Windows 10/11
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763))
        {
            int useDarkMode = 1;
            _ = DwmSetWindowAttribute(Handle, 20, ref useDarkMode, sizeof(int));
        }
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        await InitializeWebViewAsync();
        _ = CheckUpdatesBackgroundAsync();
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            // 100% User-Space data folder em %LOCALAPPDATA%\FluiStream\WebView2
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string userDataFolder = Path.Combine(localAppData, "FluiStream", "WebView2Data");
            Directory.CreateDirectory(userDataFolder);

            // Opções do WebView2: desativar restrições CORS para IPTV e ativar aceleração por hardware
            var envOptions = new CoreWebView2EnvironmentOptions(
                additionalBrowserArguments: "--disable-web-security --autoplay-policy=no-user-gesture-required --enable-features=HardwareAcceleratedVideoDecode"
            );

            var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder, envOptions);
            await _webView.EnsureCoreWebView2Async(env);

            // Mapeamento virtual para a pasta web local
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string webFolder = Path.Combine(baseDir, "web");

            if (!Directory.Exists(webFolder))
            {
                // Fallback para desenvolvimento
                string projectRoot = Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "web"));
                if (Directory.Exists(projectRoot))
                {
                    webFolder = projectRoot;
                }
            }

            if (Directory.Exists(webFolder))
            {
                _webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "app.fluistream.local",
                    webFolder,
                    CoreWebView2HostResourceAccessKind.Allow
                );
                _webView.CoreWebView2.Navigate("https://app.fluistream.local/index.html");
            }
            else
            {
                _webView.CoreWebView2.Navigate("https://cesarovies.github.io/FluiStream/");
            }
        }
        catch (Exception ex)
        {
            ShowDarkDialog(LocalizationService.Get("ErrorWebView2Title"), $"{LocalizationService.Get("ErrorWebView2Body")}\n\n{ex.Message}");
        }
    }

    private async Task CheckUpdatesBackgroundAsync()
    {
        var (available, newVersion, downloadUrl, _) = await UpdateService.CheckForUpdatesAsync();
        if (available && !string.IsNullOrEmpty(downloadUrl))
        {
            BeginInvoke(() =>
            {
                ShowUpdatePrompt(newVersion, downloadUrl);
            });
        }
    }

    private void ShowUpdatePrompt(string? newVersion, string downloadUrl)
    {
        using var promptForm = new Form
        {
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = false,
            StartPosition = FormStartPosition.CenterParent,
            BackColor = Color.FromArgb(22, 27, 34), // #161B22
            ForeColor = Color.FromArgb(230, 237, 243),
            ClientSize = new Size(460, 220),
            Text = LocalizationService.Get("UpdateAvailableTitle")
        };

        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763))
        {
            int useDarkMode = 1;
            _ = DwmSetWindowAttribute(promptForm.Handle, 20, ref useDarkMode, sizeof(int));
        }

        var lbl = new Label
        {
            Text = $"{LocalizationService.Get("UpdatePrompt")}\n\nVersão: {newVersion}",
            TextAlign = ContentAlignment.MiddleCenter,
            Dock = DockStyle.Top,
            Height = 100,
            Font = new Font("Segoe UI", 10, FontStyle.Regular)
        };

        var btnUpdate = new Button
        {
            Text = LocalizationService.Get("BtnUpdate"),
            BackColor = Color.FromArgb(35, 134, 54),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Size = new Size(160, 36)
        };
        btnUpdate.FlatAppearance.BorderSize = 0;

        var btnCancel = new Button
        {
            Text = LocalizationService.Get("BtnCancel"),
            BackColor = Color.FromArgb(33, 38, 45),
            ForeColor = Color.FromArgb(230, 237, 243),
            FlatStyle = FlatStyle.Flat,
            Size = new Size(140, 36),
            DialogResult = DialogResult.Cancel
        };
        btnCancel.FlatAppearance.BorderColor = Color.FromArgb(48, 54, 61);

        int totalWidth = btnCancel.Width + 16 + btnUpdate.Width;
        int startX = (promptForm.ClientSize.Width - totalWidth) / 2;
        btnCancel.Location = new Point(startX, 140);
        btnUpdate.Location = new Point(startX + btnCancel.Width + 16, 140);

        btnUpdate.Click += async (s, e) =>
        {
            btnUpdate.Enabled = false;
            btnCancel.Enabled = false;
            btnUpdate.Text = "Baixando...";
            string tempZip = Path.Combine(Path.GetTempPath(), "FluiStream_Update.zip");
            await UpdateService.DownloadUpdateAsync(downloadUrl, tempZip);
            UpdateService.ApplyUpdateAndRestart(tempZip);
        };

        promptForm.Controls.Add(lbl);
        promptForm.Controls.Add(btnCancel);
        promptForm.Controls.Add(btnUpdate);
        promptForm.ShowDialog(this);
    }

    private void ShowDarkDialog(string title, string message)
    {
        using var dialog = new Form
        {
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = false,
            StartPosition = FormStartPosition.CenterParent,
            BackColor = Color.FromArgb(22, 27, 34),
            ForeColor = Color.FromArgb(230, 237, 243),
            ClientSize = new Size(420, 180),
            Text = title
        };

        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763))
        {
            int useDarkMode = 1;
            _ = DwmSetWindowAttribute(dialog.Handle, 20, ref useDarkMode, sizeof(int));
        }

        var lbl = new Label
        {
            Text = message,
            TextAlign = ContentAlignment.MiddleCenter,
            Dock = DockStyle.Top,
            Height = 90
        };

        var btnOk = new Button
        {
            Text = "OK",
            BackColor = Color.FromArgb(35, 134, 54),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Size = new Size(100, 32),
            DialogResult = DialogResult.OK
        };
        btnOk.FlatAppearance.BorderSize = 0;
        btnOk.Location = new Point((dialog.ClientSize.Width - btnOk.Width) / 2, 115);

        dialog.Controls.Add(lbl);
        dialog.Controls.Add(btnOk);
        dialog.ShowDialog(this);
    }
}
