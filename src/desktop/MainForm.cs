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

            // Ponte de mensagens com o Web App
            _webView.CoreWebView2.WebMessageReceived += (s, args) =>
            {
                try
                {
                    string json = args.WebMessageAsJson;
                    using var doc = System.Text.Json.JsonDocument.Parse(json);
                    if (doc.RootElement.TryGetProperty("type", out var typeEl) && typeEl.GetString() == "START_UPDATE")
                    {
                        string? downloadUrl = doc.RootElement.TryGetProperty("downloadUrl", out var urlEl) ? urlEl.GetString() : null;
                        string? version = doc.RootElement.TryGetProperty("version", out var verEl) ? verEl.GetString() : null;
                        if (!string.IsNullOrEmpty(downloadUrl))
                        {
                            BeginInvoke(() => ShowUpdatePrompt(version, downloadUrl, null));
                        }
                    }
                }
                catch
                {
                    // Ignore
                }
            };
        }
        catch (Exception ex)
        {
            ShowDarkDialog(LocalizationService.Get("ErrorWebView2Title"), $"{LocalizationService.Get("ErrorWebView2Body")}\n\n{ex.Message}");
        }
    }

    private async Task CheckUpdatesBackgroundAsync()
    {
        var (available, newVersion, downloadUrl, releaseNotes) = await UpdateService.CheckForUpdatesAsync();
        if (available && !string.IsNullOrEmpty(downloadUrl))
        {
            BeginInvoke(() =>
            {
                ShowUpdatePrompt(newVersion, downloadUrl, releaseNotes);
            });
        }
    }

    private void ShowUpdatePrompt(string? newVersion, string downloadUrl, string? releaseNotes)
    {
        string currentVer = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0";

        using var promptForm = new Form
        {
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = false,
            StartPosition = FormStartPosition.CenterParent,
            BackColor = Color.FromArgb(22, 27, 34), // #161B22
            ForeColor = Color.FromArgb(230, 237, 243),
            ClientSize = new Size(500, 320),
            Text = LocalizationService.Get("UpdateAvailableTitle")
        };

        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763))
        {
            int useDarkMode = 1;
            _ = DwmSetWindowAttribute(promptForm.Handle, 20, ref useDarkMode, sizeof(int));
        }

        var lblHeader = new Label
        {
            Text = $"🚀 Nova Versão Disponível: v{currentVer} → {newVersion}",
            TextAlign = ContentAlignment.MiddleCenter,
            Dock = DockStyle.Top,
            Height = 44,
            Font = new Font("Segoe UI", 11, FontStyle.Bold),
            ForeColor = Color.FromArgb(16, 185, 129) // Emerald
        };

        var txtNotes = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            BackColor = Color.FromArgb(13, 17, 23),
            ForeColor = Color.FromArgb(139, 148, 158),
            BorderStyle = BorderStyle.FixedSingle,
            Location = new Point(20, 52),
            Size = new Size(460, 120),
            Text = !string.IsNullOrWhiteSpace(releaseNotes) 
                ? releaseNotes 
                : "Melhorias de desempenho, estabilidade na reprodução e atualizações visuais."
        };

        var lblStatus = new Label
        {
            Text = LocalizationService.Get("UpdatePrompt"),
            TextAlign = ContentAlignment.MiddleCenter,
            Location = new Point(20, 180),
            Size = new Size(460, 24),
            Font = new Font("Segoe UI", 9, FontStyle.Regular)
        };

        var progressBar = new ProgressBar
        {
            Location = new Point(20, 210),
            Size = new Size(460, 14),
            Minimum = 0,
            Maximum = 100,
            Value = 0,
            Visible = false
        };

        var btnUpdate = new Button
        {
            Text = LocalizationService.Get("BtnUpdate"),
            BackColor = Color.FromArgb(35, 134, 54),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Size = new Size(180, 38),
            Font = new Font("Segoe UI", 9, FontStyle.Bold),
            Cursor = Cursors.Hand
        };
        btnUpdate.FlatAppearance.BorderSize = 0;

        var btnCancel = new Button
        {
            Text = LocalizationService.Get("BtnCancel"),
            BackColor = Color.FromArgb(33, 38, 45),
            ForeColor = Color.FromArgb(230, 237, 243),
            FlatStyle = FlatStyle.Flat,
            Size = new Size(140, 38),
            DialogResult = DialogResult.Cancel,
            Cursor = Cursors.Hand
        };
        btnCancel.FlatAppearance.BorderColor = Color.FromArgb(48, 54, 61);

        int totalWidth = btnCancel.Width + 16 + btnUpdate.Width;
        int startX = (promptForm.ClientSize.Width - totalWidth) / 2;
        btnCancel.Location = new Point(startX, 245);
        btnUpdate.Location = new Point(startX + btnCancel.Width + 16, 245);

        btnUpdate.Click += async (s, e) =>
        {
            btnUpdate.Enabled = false;
            btnCancel.Enabled = false;
            progressBar.Visible = true;
            lblStatus.Text = "Baixando atualização: 0%...";

            string tempZip = Path.Combine(Path.GetTempPath(), "FluiStream_Update.zip");
            var progress = new Progress<int>(pct =>
            {
                progressBar.Value = pct;
                lblStatus.Text = $"Baixando atualização: {pct}%";
            });

            try
            {
                await UpdateService.DownloadUpdateAsync(downloadUrl, tempZip, progress);
                lblStatus.Text = "Substituindo arquivos e reiniciando aplicação...";
                await Task.Delay(400);
                UpdateService.ApplyUpdateAndRestart(tempZip);
            }
            catch (Exception ex)
            {
                btnUpdate.Enabled = true;
                btnCancel.Enabled = true;
                progressBar.Visible = false;
                lblStatus.Text = $"Erro ao atualizar: {ex.Message}";
            }
        };

        promptForm.Controls.Add(lblHeader);
        promptForm.Controls.Add(txtNotes);
        promptForm.Controls.Add(lblStatus);
        promptForm.Controls.Add(progressBar);
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

