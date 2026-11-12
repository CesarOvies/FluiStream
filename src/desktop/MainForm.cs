using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using LibVLCSharp.Shared;
using LibVLCSharp.WinForms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace FluiStream.Desktop;

public partial class MainForm : Form
{
    private readonly WebView2 _webView;
    private LibVLC? _libVLC;
    private LibVLCSharp.Shared.MediaPlayer? _vlcPlayer;
    private VideoView? _videoView;
    private bool _isVlcActive = false;
    private bool _isFullScreen = false;
    private long _lastReportedTimeMs = 0;
    private static readonly Size DefaultMinimumWindowSize = new(800, 600);
    private static readonly Size PipMinimumWindowSize = new(240, 135);
    private FormWindowState _previousWindowState = FormWindowState.Normal;
    private FormBorderStyle _previousBorderStyle = FormBorderStyle.Sizable;
    private Rectangle _previousBounds;
    private bool _isPipMode = false;
    private FormWindowState _prePipWindowState = FormWindowState.Normal;
    private FormBorderStyle _prePipBorderStyle = FormBorderStyle.Sizable;
    private Rectangle _prePipBounds;
    private Button? _btnExitFullscreen;
    private Button? _btnCenterPlayOverlay;
    private System.Windows.Forms.Timer? _fullscreenTimer;
    private System.Windows.Forms.Timer? _vlcSingleClickTimer;
    private bool _webNavigationCompleted = false;
    private (string? Version, string DownloadUrl, string? ReleaseNotes)? _pendingHostUpdate;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    public MainForm()
    {
        KeyPreview = true;
        Text = LocalizationService.Get("AppTitle");
        try
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? 
                   (File.Exists(Path.Combine(AppContext.BaseDirectory, "app.ico")) ? new Icon(Path.Combine(AppContext.BaseDirectory, "app.ico")) : null);
        }
        catch { }
        Size = new Size(1280, 800);
        MinimumSize = new Size(800, 600);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(6, 16, 30); // #06101E
        ForeColor = Color.FromArgb(240, 246, 252); // #F0F6FC

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.FromArgb(6, 16, 30) // #06101E
        };

        InitializeVlcPlayer();

        Controls.Add(_webView);
    }

    private void InitializeVlcPlayer()
    {
        try
        {
            Core.Initialize();
            _libVLC = new LibVLC(
                "--no-osd",
                "--no-video-title-show",
                "--network-caching=2000",
                "--file-caching=2000",
                "--live-caching=2000",
                "--disc-caching=2000",
                "--sout-mux-caching=2000",
                "--avcodec-hw=dxva2,none",
                "--avcodec-skiploopfilter=4",
                "--drop-late-frames",
                "--skip-frames",
                "--clock-jitter=0",
                "--clock-synchro=0"
            );
            _vlcPlayer = new LibVLCSharp.Shared.MediaPlayer(_libVLC)
            {
                EnableMouseInput = false,
                EnableKeyInput = false
            };

            _videoView = new VideoView
            {
                MediaPlayer = _vlcPlayer,
                Dock = DockStyle.Fill,
                Visible = false,
                BackColor = Color.Black
            };

            _vlcSingleClickTimer = new System.Windows.Forms.Timer { Interval = 220 };
            _vlcSingleClickTimer.Tick += (s, e) =>
            {
                _vlcSingleClickTimer.Stop();
                if (_isVlcActive)
                {
                    _vlcPlayer?.Pause();
                }
            };

            _videoView.MouseClick += (s, e) =>
            {
                if (e.Button == MouseButtons.Left && _isVlcActive)
                {
                    _vlcSingleClickTimer?.Stop();
                    _vlcSingleClickTimer?.Start();
                }
            };

            _videoView.MouseDoubleClick += (s, e) =>
            {
                _vlcSingleClickTimer?.Stop();
                if (_isPipMode)
                {
                    BeginInvoke(() => SetMiniPlayerPip(false));
                }
                else if (_isVlcActive)
                {
                    BeginInvoke(ToggleVlcFullscreen);
                }
            };

            _videoView.MouseMove += (s, e) =>
            {
                if (_isFullScreen || _isPipMode)
                {
                    ShowExitFullscreenButton();
                }
            };

            _vlcPlayer.Playing += (s, e) =>
            {
                BeginInvoke(() =>
                {
                    UpdateCenterPlayOverlay(false);
                    _webView.CoreWebView2?.ExecuteScriptAsync("window.fluiStreamApp?.handlePlayerState('playing');");
                });
                Task.Delay(800).ContinueWith(_ => BeginInvoke(SendVlcTracksToWeb));
            };

            _vlcPlayer.Paused += (s, e) =>
            {
                BeginInvoke(() =>
                {
                    UpdateCenterPlayOverlay(true);
                    _webView.CoreWebView2?.ExecuteScriptAsync("window.fluiStreamApp?.handlePlayerState('paused');");
                });
            };

            _vlcPlayer.Stopped += (s, e) =>
            {
                BeginInvoke(() =>
                {
                    UpdateCenterPlayOverlay(false);
                    _webView.CoreWebView2?.ExecuteScriptAsync("window.fluiStreamApp?.handlePlayerState('idle');");
                });
            };

            _vlcPlayer.EncounteredError += (s, e) =>
            {
                if (!_isVlcActive) return;
                BeginInvoke(() =>
                {
                    _webView.CoreWebView2?.ExecuteScriptAsync("window.fluiStreamApp?.handlePlayerState('error', { details: 'VLC_STREAM_ERROR' });");
                });
            };

            _vlcPlayer.TimeChanged += (s, e) =>
            {
                if (!_isVlcActive) return;
                long timeMs = e.Time;
                if (Math.Abs(timeMs - _lastReportedTimeMs) >= 400)
                {
                    _lastReportedTimeMs = timeMs;
                    long lenMs = _vlcPlayer?.Length ?? 0;
                    float pos = _vlcPlayer?.Position ?? 0f;
                    bool isSeekable = _vlcPlayer?.IsSeekable ?? false;
                    BeginInvoke(() =>
                    {
                        double curSec = timeMs / 1000.0;
                        double durSec = lenMs > 0 ? (lenMs / 1000.0) : 0;
                        string script = $"window.fluiStreamApp?.handleVlcTimeUpdate({curSec.ToString(System.Globalization.CultureInfo.InvariantCulture)}, {durSec.ToString(System.Globalization.CultureInfo.InvariantCulture)}, {pos.ToString(System.Globalization.CultureInfo.InvariantCulture)}, {(isSeekable ? "true" : "false")});";
                        _webView.CoreWebView2?.ExecuteScriptAsync(script);
                    });
                }
            };

            Controls.Add(_videoView);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"LibVLC init failed: {ex.Message}");
        }
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

            // Opções do WebView2: desativar restrições CORS para IPTV e ativar aceleração por hardware e Picture-in-Picture
            var envOptions = new CoreWebView2EnvironmentOptions(
                additionalBrowserArguments: "--disable-web-security --allow-running-insecure-content --disable-features=BlockInsecurePrivateNetworkRequests,IsolateOrigins,site-per-process --disable-site-isolation-trials --autoplay-policy=no-user-gesture-required --enable-features=HardwareAcceleratedVideoDecode,PictureInPicture"
            );

            var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder, envOptions);
            await _webView.EnsureCoreWebView2Async(env);

            // Suporte completo a tela cheia para elementos HTML5 (Player HLS/Web)
            _webView.CoreWebView2.ContainsFullScreenElementChanged += (s, e) =>
            {
                BeginInvoke(() =>
                {
                    if (_webView.CoreWebView2.ContainsFullScreenElement)
                    {
                        _previousWindowState = WindowState;
                        _previousBorderStyle = FormBorderStyle;
                        _previousBounds = Bounds;

                        SuspendLayout();
                        FormBorderStyle = FormBorderStyle.None;
                        WindowState = FormWindowState.Normal;
                        Bounds = Screen.FromControl(this).Bounds;
                        ResumeLayout(true);
                    }
                    else
                    {
                        SuspendLayout();
                        FormBorderStyle = _previousBorderStyle;
                        WindowState = _previousWindowState;
                        Bounds = _previousBounds;
                        ResumeLayout(true);
                    }
                });
            };

            // Registrar Host Object nativo de alta performance para requisições IPTV sem restrições de CORS
            _webView.CoreWebView2.AddHostObjectToScript("nativeBridge", new NativeBridge());
            _webView.CoreWebView2.NavigationCompleted += (_, navArgs) =>
            {
                if (navArgs.IsSuccess)
                {
                    _webNavigationCompleted = true;
                    BeginInvoke(DispatchPendingUpdateNotification);
                }
            };

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
                _webView.CoreWebView2.Navigate("http://app.fluistream.local/index.html");
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
                    if (doc.RootElement.TryGetProperty("type", out var typeEl))
                    {
                        string msgType = typeEl.GetString() ?? "";
                        if (msgType == "START_UPDATE")
                        {
                            string? downloadUrl = doc.RootElement.TryGetProperty("downloadUrl", out var urlEl) ? urlEl.GetString() : null;
                            string? version = doc.RootElement.TryGetProperty("version", out var verEl) ? verEl.GetString() : null;
                            if (!string.IsNullOrEmpty(downloadUrl))
                            {
                                BeginInvoke(() => ShowUpdatePrompt(version, downloadUrl, null));
                            }
                        }
                        else if (msgType == "VLC_LAYOUT_UPDATE")
                        {
                            if (doc.RootElement.TryGetProperty("rect", out var rectEl))
                            {
                                int x = rectEl.GetProperty("x").GetInt32();
                                int y = rectEl.GetProperty("y").GetInt32();
                                int w = rectEl.GetProperty("width").GetInt32();
                                int h = rectEl.GetProperty("height").GetInt32();
                                bool visible = rectEl.TryGetProperty("visible", out var visEl) ? visEl.GetBoolean() : true;
                                BeginInvoke(() => ApplyVlcLayout(x, y, w, h, visible));
                            }
                        }
                        else if (msgType == "VLC_PLAYER_COMMAND")
                        {
                            string action = doc.RootElement.TryGetProperty("action", out var actEl) ? (actEl.GetString() ?? "") : "";
                            if (action == "PLAY")
                            {
                                string? streamUrl = doc.RootElement.TryGetProperty("url", out var uEl) ? uEl.GetString() : null;
                                string? ratio = doc.RootElement.TryGetProperty("aspectRatio", out var rEl) ? rEl.GetString() : "auto";
                                if (!string.IsNullOrEmpty(streamUrl))
                                {
                                    BeginInvoke(() => PlayVlcStream(streamUrl, ratio));
                                }
                            }
                            else if (action == "STOP")
                            {
                                BeginInvoke(StopVlcStream);
                            }
                            else if (action == "TOGGLE_FULLSCREEN")
                            {
                                BeginInvoke(ToggleVlcFullscreen);
                            }
                            else if (action == "TOGGLE_PIP")
                            {
                                BeginInvoke(ToggleMiniPlayerPip);
                            }
                            else if (action == "SET_ASPECT_RATIO")
                            {
                                string? ratio = doc.RootElement.TryGetProperty("ratio", out var rEl) ? rEl.GetString() : "auto";
                                BeginInvoke(() => SetVlcAspectRatio(ratio));
                            }
                            else if (action == "SET_VOLUME")
                            {
                                if (doc.RootElement.TryGetProperty("volume", out var vEl))
                                {
                                    float vol = (float)vEl.GetDouble();
                                    BeginInvoke(() => { if (_vlcPlayer != null) _vlcPlayer.Volume = (int)Math.Clamp(vol * 100, 0, 100); });
                                }
                            }
                            else if (action == "SET_MUTE")
                            {
                                if (doc.RootElement.TryGetProperty("muted", out var mEl))
                                {
                                    bool muted = mEl.GetBoolean();
                                    BeginInvoke(() => { if (_vlcPlayer != null) _vlcPlayer.Mute = muted; });
                                }
                            }
                            else if (action == "TOGGLE_PAUSE")
                            {
                                BeginInvoke(() => { _vlcPlayer?.Pause(); });
                            }
                            else if (action == "SEEK")
                            {
                                if (doc.RootElement.TryGetProperty("position", out var posEl))
                                {
                                    float pos = (float)posEl.GetDouble();
                                    BeginInvoke(() => {
                                        if (_vlcPlayer != null && _vlcPlayer.IsSeekable)
                                        {
                                            _vlcPlayer.Position = Math.Clamp(pos, 0f, 1f);
                                        }
                                    });
                                }
                            }
                            else if (action == "GET_TRACKS")
                            {
                                BeginInvoke(SendVlcTracksToWeb);
                            }
                            else if (action == "SET_AUDIO_TRACK")
                            {
                                if (doc.RootElement.TryGetProperty("trackId", out var aEl))
                                {
                                    int aId = aEl.GetInt32();
                                    BeginInvoke(() => { if (_vlcPlayer != null) _vlcPlayer.SetAudioTrack(aId); });
                                }
                            }
                            else if (action == "SET_SUBTITLE_TRACK")
                            {
                                if (doc.RootElement.TryGetProperty("trackId", out var sEl))
                                {
                                    int sId = sEl.GetInt32();
                                    BeginInvoke(() => { if (_vlcPlayer != null) _vlcPlayer.SetSpu(sId); });
                                }
                            }
                            else if (action == "SET_VISIBILITY")
                            {
                                if (doc.RootElement.TryGetProperty("visible", out var visEl))
                                {
                                    bool isVis = visEl.GetBoolean();
                                    BeginInvoke(() => {
                                        if (_videoView != null && _isVlcActive && !_isFullScreen && !_isPipMode)
                                        {
                                            _videoView.Visible = isVis;
                                        }
                                    });
                                }
                            }
                        }
                        else if (msgType == "NATIVE_FETCH")
                        {
                            string reqId = doc.RootElement.TryGetProperty("id", out var idEl) ? (idEl.GetString() ?? "") : "";
                            string targetUrl = doc.RootElement.TryGetProperty("url", out var uEl) ? (uEl.GetString() ?? "") : "";
                            _ = Task.Run(async () =>
                            {
                                try
                                {
                                    var bridge = new NativeBridge();
                                    string content = await bridge.FetchTextAsync(targetUrl);
                                    string jsonEscaped = System.Text.Json.JsonSerializer.Serialize(content);
                                    BeginInvoke(() =>
                                    {
                                        _webView.CoreWebView2?.ExecuteScriptAsync($"window.__onNativeFetchResult?.('{reqId}', true, {jsonEscaped}, null);");
                                    });
                                }
                                catch (Exception ex)
                                {
                                    string errEscaped = System.Text.Json.JsonSerializer.Serialize(ex.Message);
                                    BeginInvoke(() =>
                                    {
                                        _webView.CoreWebView2?.ExecuteScriptAsync($"window.__onNativeFetchResult?.('{reqId}', false, null, {errEscaped});");
                                    });
                                }
                            });
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
            _pendingHostUpdate = (newVersion, downloadUrl, releaseNotes);
            BeginInvoke(DispatchPendingUpdateNotification);
        }
    }

    private void DispatchPendingUpdateNotification()
    {
        if (!_webNavigationCompleted || _webView?.CoreWebView2 == null || !_pendingHostUpdate.HasValue) return;
        var (ver, url, notes) = _pendingHostUpdate.Value;
        string verJson = System.Text.Json.JsonSerializer.Serialize(ver ?? "");
        string urlJson = System.Text.Json.JsonSerializer.Serialize(url ?? "");
        string notesJson = System.Text.Json.JsonSerializer.Serialize(notes ?? "");
        _ = _webView.CoreWebView2.ExecuteScriptAsync($"window.fluiStreamApp?.notifyHostUpdateAvailable({verJson}, {urlJson}, {notesJson});");
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
            BackColor = Color.FromArgb(15, 23, 42), // #0F172A
            ForeColor = Color.FromArgb(240, 246, 252), // #F0F6FC
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
            Text = string.Format(LocalizationService.Get("UpdatePromptHeader"), currentVer, newVersion ?? ""),
            TextAlign = ContentAlignment.MiddleCenter,
            Dock = DockStyle.Top,
            Height = 44,
            Font = new Font("Segoe UI", 11, FontStyle.Bold),
            ForeColor = Color.FromArgb(245, 158, 11) // #F59E0B Amber
        };

        var txtNotes = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            BackColor = Color.FromArgb(6, 16, 30), // #06101E
            ForeColor = Color.FromArgb(148, 163, 184), // #94A3B8
            BorderStyle = BorderStyle.FixedSingle,
            Location = new Point(20, 52),
            Size = new Size(460, 120),
            Text = !string.IsNullOrWhiteSpace(releaseNotes) 
                ? releaseNotes 
                : LocalizationService.Get("UpdateNotesFallback")
        };

        var lblStatus = new Label
        {
            Text = LocalizationService.Get("UpdatePrompt"),
            TextAlign = ContentAlignment.MiddleCenter,
            Location = new Point(20, 180),
            Size = new Size(460, 24),
            AutoEllipsis = true,
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
            BackColor = Color.FromArgb(16, 185, 129), // #10B981 Emerald
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
            BackColor = Color.FromArgb(6, 16, 30), // #06101E
            ForeColor = Color.FromArgb(240, 246, 252), // #F0F6FC
            FlatStyle = FlatStyle.Flat,
            Size = new Size(140, 38),
            DialogResult = DialogResult.Cancel,
            Cursor = Cursors.Hand
        };
        btnCancel.FlatAppearance.BorderColor = Color.FromArgb(30, 41, 59); // #1E293B

        int totalWidth = btnCancel.Width + 16 + btnUpdate.Width;
        int startX = (promptForm.ClientSize.Width - totalWidth) / 2;
        btnCancel.Location = new Point(startX, 245);
        btnUpdate.Location = new Point(startX + btnCancel.Width + 16, 245);

        btnUpdate.Click += async (s, e) =>
        {
            btnUpdate.Enabled = false;
            btnCancel.Enabled = false;
            progressBar.Visible = true;
            lblStatus.Text = string.Format(LocalizationService.Get("UpdateDownloading"), 0);

            string tempZip = Path.Combine(Path.GetTempPath(), "FluiStream_Update.zip");
            var progress = new Progress<int>(pct =>
            {
                progressBar.Value = pct;
                lblStatus.Text = string.Format(LocalizationService.Get("UpdateDownloading"), pct);
            });

            try
            {
                await UpdateService.DownloadUpdateAsync(downloadUrl, tempZip, progress);
                lblStatus.Text = LocalizationService.Get("UpdateApplying");
                await Task.Delay(400);
                UpdateService.ApplyUpdateAndRestart(tempZip);
            }
            catch (Exception ex)
            {
                btnUpdate.Enabled = true;
                btnCancel.Enabled = true;
                progressBar.Visible = false;
                lblStatus.Text = string.Format(LocalizationService.Get("UpdateError"), ex.Message);
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

    private void PlayVlcStream(string streamUrl, string? ratio = "auto")
    {
        if (_vlcPlayer == null || _libVLC == null || _videoView == null) return;
        try
        {
            _isVlcActive = true;
            using var media = new Media(_libVLC, streamUrl, FromType.FromLocation);
            media.AddOption(":network-caching=2000");
            media.AddOption(":clock-jitter=0");
            media.AddOption(":clock-synchro=0");
            _vlcPlayer.Play(media);

            SetVlcAspectRatio(ratio);

            if (_isFullScreen || _isPipMode)
            {
                _videoView.Dock = DockStyle.Fill;
                _videoView.Visible = true;
                _videoView.BringToFront();
            }
            else
            {
                _videoView.Visible = true;
                _videoView.BringToFront();
                UpdateVideoViewLayout();
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error playing VLC stream: {ex.Message}");
            _webView.CoreWebView2?.ExecuteScriptAsync("window.fluiStreamApp?.handlePlayerState('error', { details: 'VLC_INIT_FAILED' });");
        }
    }

    private void StopVlcStream()
    {
        if (_vlcPlayer == null || _videoView == null) return;
        _isVlcActive = false;
        try
        {
            if (_isFullScreen)
            {
                SetVlcFullscreen(false);
            }
            if (_isPipMode)
            {
                SetMiniPlayerPip(false);
            }
            _vlcPlayer.Stop();
            _videoView.Visible = false;
            UpdateCenterPlayOverlay(false);
        }
        catch
        {
            // Ignore
        }
    }

    private void SetVlcAspectRatio(string? ratio)
    {
        if (_vlcPlayer == null) return;
        try
        {
            switch (ratio)
            {
                case "16:9":
                    _vlcPlayer.AspectRatio = "16:9";
                    _vlcPlayer.Scale = 0;
                    break;
                case "4:3":
                    _vlcPlayer.AspectRatio = "4:3";
                    _vlcPlayer.Scale = 0;
                    break;
                case "fill":
                    if (_videoView != null && _videoView.Width > 0 && _videoView.Height > 0)
                    {
                        _vlcPlayer.AspectRatio = $"{_videoView.Width}:{_videoView.Height}";
                    }
                    else
                    {
                        _vlcPlayer.AspectRatio = null;
                    }
                    _vlcPlayer.Scale = 0;
                    break;
                case "auto":
                default:
                    _vlcPlayer.AspectRatio = null; // Auto regula para a proporção original do fluxo
                    _vlcPlayer.Scale = 0;
                    break;
            }
        }
        catch
        {
            // Ignore
        }
    }

    private void SendVlcTracksToWeb()
    {
        if (_vlcPlayer == null || !_isVlcActive) return;
        try
        {
            var audioDescs = _vlcPlayer.AudioTrackDescription;
            var spuDescs = _vlcPlayer.SpuDescription;
            int currentAudio = _vlcPlayer.AudioTrack;
            int currentSpu = _vlcPlayer.Spu;

            var audioList = new System.Collections.Generic.List<object>();
            if (audioDescs != null)
            {
                foreach (var t in audioDescs)
                {
                    audioList.Add(new { id = t.Id, name = t.Name });
                }
            }

            var spuList = new System.Collections.Generic.List<object>();
            if (spuDescs != null)
            {
                foreach (var s in spuDescs)
                {
                    spuList.Add(new { id = s.Id, name = s.Name });
                }
            }

            var payload = new
            {
                audioTracks = audioList,
                subtitleTracks = spuList,
                currentAudioTrack = currentAudio,
                currentSubtitleTrack = currentSpu
            };

            string json = System.Text.Json.JsonSerializer.Serialize(payload);
            BeginInvoke(() =>
            {
                _webView.CoreWebView2?.ExecuteScriptAsync($"window.fluiStreamApp?.handleNativeTracks({json});");
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"SendVlcTracksToWeb failed: {ex.Message}");
        }
    }

    private void ToggleMiniPlayerPip()
    {
        SetMiniPlayerPip(!_isPipMode);
    }

    private void SetMiniPlayerPip(bool enabled)
    {
        if (_isPipMode == enabled) return;

        if (enabled)
        {
            if (_isFullScreen)
            {
                SetVlcFullscreen(false);
            }

            _prePipWindowState = WindowState;
            _prePipBorderStyle = FormBorderStyle;
            _prePipBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;

            _isPipMode = true;
            SuspendLayout();
            if (WindowState != FormWindowState.Normal)
            {
                WindowState = FormWindowState.Normal;
            }
            MinimumSize = PipMinimumWindowSize;
            FormBorderStyle = FormBorderStyle.SizableToolWindow;
            TopMost = true;

            var workArea = Screen.FromControl(this).WorkingArea;
            int pipW = 480;
            int pipH = 270;
            Bounds = new Rectangle(workArea.Right - pipW - 20, workArea.Bottom - pipH - 20, pipW, pipH);

            if (_isVlcActive && _videoView != null)
            {
                _videoView.Dock = DockStyle.Fill;
                _videoView.Visible = true;
                _videoView.BringToFront();
            }
            ResumeLayout(true);

            ShowExitFullscreenButton();
            _webView.CoreWebView2?.ExecuteScriptAsync("document.body.classList.add('desktop-mini-pip');");
        }
        else
        {
            _isPipMode = false;
            SuspendLayout();
            TopMost = false;
            FormBorderStyle = _prePipBorderStyle;
            MinimumSize = DefaultMinimumWindowSize;
            if (WindowState != FormWindowState.Normal)
            {
                WindowState = FormWindowState.Normal;
            }
            if (_prePipBounds.Width > 0 && _prePipBounds.Height > 0)
            {
                Bounds = _prePipBounds;
            }
            WindowState = _prePipWindowState;

            if (_btnExitFullscreen != null)
            {
                _btnExitFullscreen.Visible = false;
            }

            if (_isVlcActive && _videoView != null)
            {
                _videoView.Dock = DockStyle.None;
            }
            ResumeLayout(true);

            _webView.CoreWebView2?.ExecuteScriptAsync("document.body.classList.remove('desktop-mini-pip'); window.fluiStreamApp?.player?.reportLayout();");
            if (_isVlcActive && _videoView != null)
            {
                BeginInvoke(UpdateVideoViewLayout);
            }
        }
    }

    private void ToggleVlcFullscreen()
    {
        SetVlcFullscreen(!_isFullScreen);
    }

    private void SetVlcFullscreen(bool fullscreen)
    {
        if (_videoView == null) return;
        if (_isFullScreen == fullscreen) return;

        _isFullScreen = fullscreen;

        if (_isFullScreen)
        {
            _previousWindowState = WindowState;
            _previousBorderStyle = FormBorderStyle;
            _previousBounds = Bounds;

            SuspendLayout();
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;
            Bounds = Screen.FromControl(this).Bounds;

            _videoView.Dock = DockStyle.Fill;
            _videoView.Visible = true;
            _videoView.BringToFront();
            ResumeLayout(true);

            ShowExitFullscreenButton();
            _videoView.Focus();
        }
        else
        {
            SuspendLayout();
            FormBorderStyle = _previousBorderStyle;
            WindowState = _previousWindowState;
            Bounds = _previousBounds;

            _videoView.Dock = DockStyle.None;
            ResumeLayout(true);

            if (_btnExitFullscreen != null)
            {
                _btnExitFullscreen.Visible = false;
            }

            UpdateVideoViewLayout();
        }
    }

    private void UpdateCenterPlayOverlay(bool show)
    {
        if (!show || !_isVlcActive || _videoView == null || !_videoView.Visible)
        {
            if (_btnCenterPlayOverlay != null)
            {
                _btnCenterPlayOverlay.Visible = false;
            }
            return;
        }

        if (_btnCenterPlayOverlay == null)
        {
            _btnCenterPlayOverlay = new Button
            {
                Text = "▶",
                Size = new Size(68, 68),
                BackColor = Color.FromArgb(220, 15, 23, 42),
                ForeColor = Color.FromArgb(245, 158, 11),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 20, FontStyle.Bold)
            };
            _btnCenterPlayOverlay.FlatAppearance.BorderSize = 2;
            _btnCenterPlayOverlay.FlatAppearance.BorderColor = Color.FromArgb(245, 158, 11);
            _btnCenterPlayOverlay.Click += (s, e) => _vlcPlayer?.Pause();
            Controls.Add(_btnCenterPlayOverlay);
        }

        int cx = _videoView.Left + Math.Max(0, (_videoView.Width - _btnCenterPlayOverlay.Width) / 2);
        int cy = _videoView.Top + Math.Max(0, (_videoView.Height - _btnCenterPlayOverlay.Height) / 2);
        _btnCenterPlayOverlay.Location = new Point(cx, cy);
        _btnCenterPlayOverlay.Visible = true;
        _btnCenterPlayOverlay.BringToFront();
    }

    private void ShowExitFullscreenButton()
    {
        if (!_isFullScreen && !_isPipMode) return;
        if (_btnExitFullscreen == null)
        {
            _btnExitFullscreen = new Button
            {
                Text = LocalizationService.Get(_isPipMode ? "ExitPipBtn" : "ExitFullscreenBtn"),
                Size = new Size(190, 36),
                BackColor = Color.FromArgb(220, 15, 23, 42), // #0F172A
                ForeColor = Color.FromArgb(240, 246, 252), // #F0F6FC
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 9, FontStyle.Bold),
                Anchor = AnchorStyles.Top | AnchorStyles.Right
            };
            _btnExitFullscreen.FlatAppearance.BorderSize = 1;
            _btnExitFullscreen.FlatAppearance.BorderColor = Color.FromArgb(245, 158, 11); // #F59E0B
            _btnExitFullscreen.Click += (s, e) =>
            {
                if (_isPipMode) SetMiniPlayerPip(false);
                else SetVlcFullscreen(false);
            };
            Controls.Add(_btnExitFullscreen);

            _fullscreenTimer = new System.Windows.Forms.Timer { Interval = 3000 };
            _fullscreenTimer.Tick += (s, e) =>
            {
                _fullscreenTimer.Stop();
                if ((_isFullScreen || _isPipMode) && _btnExitFullscreen != null)
                {
                    _btnExitFullscreen.Visible = false;
                }
            };
        }

        _btnExitFullscreen.Text = LocalizationService.Get(_isPipMode ? "ExitPipBtn" : "ExitFullscreenBtn");
        _btnExitFullscreen.Location = new Point(Math.Max(8, ClientSize.Width - _btnExitFullscreen.Width - 16), 12);
        _btnExitFullscreen.Visible = true;
        _btnExitFullscreen.BringToFront();
        _fullscreenTimer?.Stop();
        _fullscreenTimer?.Start();
    }

    private void ApplyVlcLayout(int x, int y, int width, int height, bool visible)
    {
        if (_videoView == null || !_isVlcActive || _isFullScreen || _isPipMode) return;

        if (!visible || width <= 0 || height <= 0)
        {
            _videoView.Visible = false;
            return;
        }

        _videoView.Dock = DockStyle.None;
        _videoView.SetBounds(x, y, width, height);
        _videoView.Visible = true;
        _videoView.BringToFront();
        if (_btnCenterPlayOverlay != null && _btnCenterPlayOverlay.Visible)
        {
            UpdateCenterPlayOverlay(true);
        }
    }

    private async void UpdateVideoViewLayout()
    {
        if (!_isVlcActive || _videoView == null || _webView.CoreWebView2 == null || _isFullScreen || _isPipMode) return;
        try
        {
            // Consulta as dimensões exatas da área #player-wrapper no HTML, ajustando para devicePixelRatio
            string script = @"(() => {
                const el = document.getElementById('player-wrapper');
                if (!el) return null;
                const rect = el.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                return JSON.stringify({
                    x: Math.round(rect.left * dpr),
                    y: Math.round(rect.top * dpr),
                    width: Math.round(rect.width * dpr),
                    height: Math.round(rect.height * dpr),
                    visible: rect.width > 0 && rect.height > 0 && rect.bottom > 20 && rect.top < window.innerHeight
                });
            })()";

            string resultJson = await _webView.CoreWebView2.ExecuteScriptAsync(script);
            if (!string.IsNullOrEmpty(resultJson) && resultJson != "null")
            {
                if (resultJson.StartsWith("\"") && resultJson.EndsWith("\""))
                {
                    resultJson = System.Text.Json.JsonSerializer.Deserialize<string>(resultJson) ?? resultJson;
                }

                using var doc = System.Text.Json.JsonDocument.Parse(resultJson);
                int x = doc.RootElement.GetProperty("x").GetInt32();
                int y = doc.RootElement.GetProperty("y").GetInt32();
                int w = doc.RootElement.GetProperty("width").GetInt32();
                int h = doc.RootElement.GetProperty("height").GetInt32();
                bool visible = doc.RootElement.TryGetProperty("visible", out var visEl) ? visEl.GetBoolean() : true;

                ApplyVlcLayout(x, y, w, h, visible);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"UpdateVideoViewLayout failed: {ex.Message}");
        }
    }

    private const int WM_APPCOMMAND = 0x0319;
    private const int APPCOMMAND_VOLUME_MUTE = 8;
    private const int APPCOMMAND_VOLUME_DOWN = 9;
    private const int APPCOMMAND_VOLUME_UP = 10;

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_APPCOMMAND)
        {
            int cmd = (int)((m.LParam.ToInt64() >> 16) & 0xFFFF);
            if (cmd == APPCOMMAND_VOLUME_UP)
            {
                AdjustVlcVolume(5);
                m.Result = (IntPtr)1;
                return;
            }
            else if (cmd == APPCOMMAND_VOLUME_DOWN)
            {
                AdjustVlcVolume(-5);
                m.Result = (IntPtr)1;
                return;
            }
            else if (cmd == APPCOMMAND_VOLUME_MUTE)
            {
                ToggleVlcMute();
                m.Result = (IntPtr)1;
                return;
            }
        }
        base.WndProc(ref m);
    }

    private void AdjustVlcVolume(int delta)
    {
        if (_vlcPlayer != null)
        {
            int newVol = Math.Clamp(_vlcPlayer.Volume + delta, 0, 100);
            _vlcPlayer.Volume = newVol;
            float norm = newVol / 100f;
            _webView.CoreWebView2?.ExecuteScriptAsync($"window.fluiStreamApp?.handleHardwareVolume({norm.ToString(System.Globalization.CultureInfo.InvariantCulture)}, false);");
        }
    }

    private void ToggleVlcMute()
    {
        if (_vlcPlayer != null)
        {
            _vlcPlayer.Mute = !_vlcPlayer.Mute;
            float norm = _vlcPlayer.Volume / 100f;
            _webView.CoreWebView2?.ExecuteScriptAsync($"window.fluiStreamApp?.handleHardwareVolume({norm.ToString(System.Globalization.CultureInfo.InvariantCulture)}, {_vlcPlayer.Mute.ToString().ToLower()});");
        }
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape && _isPipMode)
        {
            SetMiniPlayerPip(false);
            e.Handled = true;
            return;
        }
        if (_isVlcActive)
        {
            if (e.KeyCode == Keys.F11 || e.KeyCode == Keys.F)
            {
                ToggleVlcFullscreen();
                e.Handled = true;
            }
            else if (e.KeyCode == Keys.Escape && _isFullScreen)
            {
                SetVlcFullscreen(false);
                e.Handled = true;
            }
            else if (e.KeyCode == Keys.Space && _vlcPlayer != null)
            {
                _vlcPlayer.Pause();
                e.Handled = true;
            }
            else if (e.KeyCode == Keys.M && _vlcPlayer != null)
            {
                ToggleVlcMute();
                e.Handled = true;
            }
            else if (e.KeyCode == Keys.VolumeUp)
            {
                AdjustVlcVolume(5);
                e.Handled = true;
            }
            else if (e.KeyCode == Keys.VolumeDown)
            {
                AdjustVlcVolume(-5);
                e.Handled = true;
            }
            else if (e.KeyCode == Keys.VolumeMute)
            {
                ToggleVlcMute();
                e.Handled = true;
            }
        }
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (_isVlcActive)
        {
            if (_isFullScreen || _isPipMode)
            {
                _videoView?.SetBounds(0, 0, ClientSize.Width, ClientSize.Height);
            }
            else
            {
                UpdateVideoViewLayout();
            }
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        try
        {
            _vlcPlayer?.Stop();
            _vlcPlayer?.Dispose();
            _libVLC?.Dispose();
        }
        catch
        {
            // Ignore
        }
        base.OnFormClosing(e);
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
            BackColor = Color.FromArgb(15, 23, 42), // #0F172A
            ForeColor = Color.FromArgb(240, 246, 252), // #F0F6FC
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
            BackColor = Color.FromArgb(16, 185, 129), // #10B981
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

