using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
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
    private Point _lastVlcCursorPos = Point.Empty;
    private long _lastVlcActivityTick = 0;
    private bool _vlcFullscreenHudVisible = true;
    private bool _webNavigationCompleted = false;
    private (string? Version, string DownloadUrl, string? ReleaseNotes)? _pendingHostUpdate;
    private string[] _vlcFallbackUrls = Array.Empty<string>();
    private int _vlcFallbackIndex = 0;
    private string _vlcAspectRatio = "auto";
    private const int MaxMultiScreenSlots = 4;
    private readonly LibVLCSharp.Shared.MediaPlayer?[] _msPlayers = new LibVLCSharp.Shared.MediaPlayer?[MaxMultiScreenSlots];
    private readonly VideoView?[] _msVideoViews = new VideoView?[MaxMultiScreenSlots];
    private readonly bool[] _msSlotActive = new bool[MaxMultiScreenSlots];
    private readonly string[][] _msSlotFallbacks = new string[MaxMultiScreenSlots][];
    private readonly int[] _msSlotFallbackIndex = new int[MaxMultiScreenSlots];
    private int _msActiveAudioSlot = 0;
    private Button? _btnVlcTools;
    private Panel? _pnlVlcToolsMenu;
    private ComboBox? _cmbVlcAspect;
    private ComboBox? _cmbVlcAudio;
    private ComboBox? _cmbVlcSubtitles;
    private TrackBar? _trkVlcVolume;
    private Button? _btnVlcMute;
    private bool _suppressVlcTrackEvents = false;
    private HttpListener? _localProxyListener;
    private string _localProxyBaseUrl = "";
    private static readonly HttpClient _proxyHttpClient = CreateProxyHttpClient();

    private sealed class VlcTrackOption
    {
        public int Id { get; init; }
        public string Name { get; init; } = "";
        public override string ToString() => Name;
    }

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
                "--avcodec-hw=d3d11va,dxva2,none",
                "--drop-late-frames",
                "--http-reconnect"
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
                if (_pnlVlcToolsMenu != null && _pnlVlcToolsMenu.Visible)
                {
                    _pnlVlcToolsMenu.Visible = false;
                }
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
                if (!_isFullScreen && !_isPipMode) return;
                var cur = Cursor.Position;
                if (Math.Abs(cur.X - _lastVlcCursorPos.X) < 3 && Math.Abs(cur.Y - _lastVlcCursorPos.Y) < 3)
                {
                    return;
                }
                _lastVlcCursorPos = cur;
                ShowExitFullscreenButton();
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
                    if (_vlcFallbackIndex < _vlcFallbackUrls.Length)
                    {
                        string nextUrl = _vlcFallbackUrls[_vlcFallbackIndex++];
                        if (!string.IsNullOrEmpty(nextUrl))
                        {
                            StartVlcMedia(nextUrl, _vlcAspectRatio);
                            return;
                        }
                    }
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

            // Inicia proxy HTTP user-space local (127.0.0.1) e injeta headers IPTV no WebView2
            StartLocalStreamProxy();
            if (!string.IsNullOrEmpty(_localProxyBaseUrl))
            {
                await _webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                    $"window.__fluiLocalProxyUrl = {System.Text.Json.JsonSerializer.Serialize(_localProxyBaseUrl)};"
                );
            }

            _webView.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            _webView.CoreWebView2.WebResourceRequested += (_, reqArgs) =>
            {
                try
                {
                    string uri = reqArgs.Request.Uri ?? "";
                    if ((uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                        && !uri.Contains("app.fluistream.local", StringComparison.OrdinalIgnoreCase)
                        && !uri.Contains("127.0.0.1", StringComparison.OrdinalIgnoreCase)
                        && !uri.Contains("localhost", StringComparison.OrdinalIgnoreCase)
                        && !uri.Contains("jsdelivr.net", StringComparison.OrdinalIgnoreCase)
                        && !uri.Contains("googleapis.com", StringComparison.OrdinalIgnoreCase)
                        && !uri.Contains("gstatic.com", StringComparison.OrdinalIgnoreCase))
                    {
                        reqArgs.Request.Headers.SetHeader("User-Agent", "IPTVSmartersPro/3.1.5 (Linux;Android 11) VLC/3.0.20");
                        reqArgs.Request.Headers.RemoveHeader("Origin");
                        reqArgs.Request.Headers.RemoveHeader("Referer");
                    }
                }
                catch
                {
                    // Ignore header restriction on internal requests
                }
            };
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
                        else if (msgType == "MULTISCREEN_LAYOUT_UPDATE")
                        {
                            if (doc.RootElement.TryGetProperty("slots", out var slotsEl) && slotsEl.ValueKind == System.Text.Json.JsonValueKind.Array)
                            {
                                var updates = new System.Collections.Generic.List<(int slotIndex, int x, int y, int w, int h, bool visible)>();
                                foreach (var itemEl in slotsEl.EnumerateArray())
                                {
                                    int sIdx = itemEl.TryGetProperty("slotIndex", out var idxEl) ? idxEl.GetInt32() : -1;
                                    int x = itemEl.TryGetProperty("x", out var xEl) ? xEl.GetInt32() : 0;
                                    int y = itemEl.TryGetProperty("y", out var yEl) ? yEl.GetInt32() : 0;
                                    int w = itemEl.TryGetProperty("width", out var wEl) ? wEl.GetInt32() : 0;
                                    int h = itemEl.TryGetProperty("height", out var hEl) ? hEl.GetInt32() : 0;
                                    bool vis = itemEl.TryGetProperty("visible", out var vEl) && vEl.GetBoolean();
                                    updates.Add((sIdx, x, y, w, h, vis));
                                }
                                BeginInvoke(() => ApplyMultiScreenLayout(updates));
                            }
                        }
                        else if (msgType == "VLC_PLAYER_COMMAND")
                        {
                            string action = doc.RootElement.TryGetProperty("action", out var actEl) ? (actEl.GetString() ?? "") : "";
                            if (action == "PLAY")
                            {
                                string? streamUrl = doc.RootElement.TryGetProperty("url", out var uEl) ? uEl.GetString() : null;
                                string? ratio = doc.RootElement.TryGetProperty("aspectRatio", out var rEl) ? rEl.GetString() : "auto";
                                string[]? fallbacks = null;
                                if (doc.RootElement.TryGetProperty("fallbackUrls", out var fbEl) && fbEl.ValueKind == System.Text.Json.JsonValueKind.Array)
                                {
                                    var fbList = new System.Collections.Generic.List<string>();
                                    foreach (var fe in fbEl.EnumerateArray())
                                    {
                                        string? fu = fe.GetString();
                                        if (!string.IsNullOrEmpty(fu)) fbList.Add(fu);
                                    }
                                    fallbacks = fbList.ToArray();
                                }
                                if (!string.IsNullOrEmpty(streamUrl))
                                {
                                    BeginInvoke(() => PlayVlcStream(streamUrl, ratio, fallbacks));
                                }
                            }
                            else if (action == "MS_PLAY_SLOT")
                            {
                                int sIdx = doc.RootElement.TryGetProperty("slotIndex", out var idxEl) ? idxEl.GetInt32() : -1;
                                string? streamUrl = doc.RootElement.TryGetProperty("url", out var uEl) ? uEl.GetString() : null;
                                bool muted = !doc.RootElement.TryGetProperty("muted", out var mEl) || mEl.GetBoolean();
                                var fbList = new System.Collections.Generic.List<string>();
                                if (doc.RootElement.TryGetProperty("fallbackUrls", out var fbEl) && fbEl.ValueKind == System.Text.Json.JsonValueKind.Array)
                                {
                                    foreach (var fe in fbEl.EnumerateArray())
                                    {
                                        string? fu = fe.GetString();
                                        if (!string.IsNullOrEmpty(fu)) fbList.Add(fu);
                                    }
                                }
                                if (!string.IsNullOrEmpty(streamUrl) && sIdx >= 0 && sIdx < MaxMultiScreenSlots)
                                {
                                    BeginInvoke(() => PlayMultiScreenSlot(sIdx, streamUrl, fbList.ToArray(), muted));
                                }
                            }
                            else if (action == "MS_SET_AUDIO_SLOT")
                            {
                                int sIdx = doc.RootElement.TryGetProperty("slotIndex", out var idxEl) ? idxEl.GetInt32() : 0;
                                BeginInvoke(() => SetMultiScreenAudioSlot(sIdx));
                            }
                            else if (action == "MS_CLEAR_SLOT")
                            {
                                int sIdx = doc.RootElement.TryGetProperty("slotIndex", out var idxEl) ? idxEl.GetInt32() : -1;
                                if (sIdx >= 0 && sIdx < MaxMultiScreenSlots)
                                {
                                    BeginInvoke(() => ClearMultiScreenSlot(sIdx));
                                }
                            }
                            else if (action == "MS_CLEAR_ALL")
                            {
                                BeginInvoke(ClearAllMultiScreenSlots);
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
                                BeginInvoke(() =>
                                {
                                    _vlcAspectRatio = ratio ?? "auto";
                                    SetVlcAspectRatio(ratio);
                                    SyncVlcToolsControls();
                                });
                            }
                            else if (action == "SET_VOLUME")
                            {
                                if (doc.RootElement.TryGetProperty("volume", out var vEl))
                                {
                                    float vol = (float)vEl.GetDouble();
                                    BeginInvoke(() =>
                                    {
                                        if (_vlcPlayer != null) _vlcPlayer.Volume = (int)Math.Clamp(vol * 100, 0, 100);
                                        SyncVlcToolsControls();
                                    });
                                }
                            }
                            else if (action == "SET_MUTE")
                            {
                                if (doc.RootElement.TryGetProperty("muted", out var mEl))
                                {
                                    bool muted = mEl.GetBoolean();
                                    BeginInvoke(() =>
                                    {
                                        if (_vlcPlayer != null) _vlcPlayer.Mute = muted;
                                        SyncVlcToolsControls();
                                    });
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
                                            if (!isVis && _btnCenterPlayOverlay != null)
                                            {
                                                _btnCenterPlayOverlay.Visible = false;
                                            }
                                            RepositionVlcOverlays();
                                        }
                                    });
                                }
                            }
                            else if (action == "TOGGLE_TOOLS_MENU")
                            {
                                BeginInvoke(ToggleVlcToolsMenu);
                            }
                            else if (action == "ENSURE_LOCAL_PROXY" || action == "SET_PLAYER_ENGINE")
                            {
                                BeginInvoke(() =>
                                {
                                    StartLocalStreamProxy();
                                    if (!string.IsNullOrEmpty(_localProxyBaseUrl))
                                    {
                                        string serializedUrl = System.Text.Json.JsonSerializer.Serialize(_localProxyBaseUrl);
                                        _webView.CoreWebView2?.ExecuteScriptAsync(
                                            $"window.__fluiLocalProxyUrl = {serializedUrl}; window.fluiStreamApp?.handleLocalProxyStatus({{ active: true, url: {serializedUrl} }});"
                                        );
                                    }
                                });
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

    private void PlayVlcStream(string streamUrl, string? ratio = "auto", string[]? fallbackUrls = null)
    {
        if (_vlcPlayer == null || _libVLC == null || _videoView == null) return;
        _isVlcActive = true;
        _vlcAspectRatio = ratio ?? "auto";
        _vlcFallbackUrls = fallbackUrls ?? Array.Empty<string>();
        _vlcFallbackIndex = 0;
        StartVlcMedia(streamUrl, _vlcAspectRatio);
    }

    private void StartVlcMedia(string streamUrl, string ratio)
    {
        if (_vlcPlayer == null || _libVLC == null || _videoView == null) return;
        try
        {
            if (_isFullScreen || _isPipMode)
            {
                _videoView.Dock = DockStyle.Fill;
                _videoView.Visible = true;
                EnsureVlcOverlayZOrder();
            }
            else
            {
                UpdateVideoViewLayout();
            }

            SetVlcAspectRatio(ratio);
            EnsureVlcToolsOverlayCreated();
            SyncVlcToolsControls();
            RepositionVlcOverlays();

            using var media = new Media(_libVLC, streamUrl, FromType.FromLocation);
            media.AddOption(":network-caching=2000");
            media.AddOption(":live-caching=2000");
            media.AddOption(":http-reconnect");
            _vlcPlayer.Play(media);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error playing VLC stream: {ex.Message}");
            _webView.CoreWebView2?.ExecuteScriptAsync("window.fluiStreamApp?.handlePlayerState('error', { details: 'VLC_INIT_FAILED' });");
        }
    }

    private void EnsureMultiScreenSlotInitialized(int slotIndex)
    {
        if (_libVLC == null || slotIndex < 0 || slotIndex >= MaxMultiScreenSlots) return;
        if (_msPlayers[slotIndex] != null && _msVideoViews[slotIndex] != null) return;

        var mp = new LibVLCSharp.Shared.MediaPlayer(_libVLC)
        {
            EnableMouseInput = false,
            EnableKeyInput = false
        };
        var vv = new VideoView
        {
            MediaPlayer = mp,
            Dock = DockStyle.None,
            Visible = false,
            BackColor = Color.Black
        };

        int idx = slotIndex;
        vv.MouseClick += (s, e) =>
        {
            if (e.Button == MouseButtons.Left && _msSlotActive[idx])
            {
                BeginInvoke(() =>
                {
                    SetMultiScreenAudioSlot(idx);
                    _webView.CoreWebView2?.ExecuteScriptAsync($"window.fluiStreamApp?.selectMultiScreenAudioSlot({idx});");
                });
            }
        };

        mp.Playing += (s, e) =>
        {
            if (!_msSlotActive[idx]) return;
            BeginInvoke(() =>
            {
                mp.Mute = idx != _msActiveAudioSlot;
                _webView.CoreWebView2?.ExecuteScriptAsync($"window.fluiStreamApp?.multiScreen?.handleNativeSlotState({idx}, 'playing');");
            });
        };

        mp.EncounteredError += (s, e) =>
        {
            if (!_msSlotActive[idx]) return;
            BeginInvoke(() =>
            {
                var fallbacks = _msSlotFallbacks[idx];
                if (fallbacks != null && _msSlotFallbackIndex[idx] < fallbacks.Length)
                {
                    string nextUrl = fallbacks[_msSlotFallbackIndex[idx]++];
                    if (!string.IsNullOrEmpty(nextUrl))
                    {
                        StartMultiScreenCandidate(idx, nextUrl);
                        return;
                    }
                }
                _webView.CoreWebView2?.ExecuteScriptAsync($"window.fluiStreamApp?.multiScreen?.handleNativeSlotState({idx}, 'error', {{ details: 'VLC_STREAM_ERROR' }});");
            });
        };

        Controls.Add(vv);
        _msPlayers[slotIndex] = mp;
        _msVideoViews[slotIndex] = vv;
    }

    private void PlayMultiScreenSlot(int slotIndex, string streamUrl, string[]? fallbackUrls, bool muted)
    {
        if (slotIndex < 0 || slotIndex >= MaxMultiScreenSlots) return;
        EnsureMultiScreenSlotInitialized(slotIndex);
        if (!muted) _msActiveAudioSlot = slotIndex;
        _msSlotActive[slotIndex] = true;
        _msSlotFallbacks[slotIndex] = fallbackUrls ?? Array.Empty<string>();
        _msSlotFallbackIndex[slotIndex] = 0;

        if (_msPlayers[slotIndex] is { } mp)
        {
            mp.Mute = slotIndex != _msActiveAudioSlot;
        }
        StartMultiScreenCandidate(slotIndex, streamUrl);
    }

    private void StartMultiScreenCandidate(int slotIndex, string streamUrl)
    {
        if (_libVLC == null || slotIndex < 0 || slotIndex >= MaxMultiScreenSlots) return;
        var mp = _msPlayers[slotIndex];
        var vv = _msVideoViews[slotIndex];
        if (mp == null || vv == null) return;
        try
        {
            using var media = new Media(_libVLC, streamUrl, FromType.FromLocation);
            media.AddOption(":network-caching=2000");
            media.AddOption(":live-caching=2000");
            media.AddOption(":http-reconnect");
            mp.Mute = slotIndex != _msActiveAudioSlot;
            mp.Play(media);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error playing multi-screen slot {slotIndex}: {ex.Message}");
            _webView.CoreWebView2?.ExecuteScriptAsync($"window.fluiStreamApp?.multiScreen?.handleNativeSlotState({slotIndex}, 'error', {{ details: 'VLC_INIT_FAILED' }});");
        }
    }

    private void SetMultiScreenAudioSlot(int slotIndex)
    {
        _msActiveAudioSlot = slotIndex;
        for (int i = 0; i < MaxMultiScreenSlots; i++)
        {
            if (_msPlayers[i] is { } mp)
            {
                mp.Mute = i != slotIndex;
            }
        }
    }

    private void ApplyMultiScreenLayout(System.Collections.Generic.List<(int slotIndex, int x, int y, int w, int h, bool visible)> updates)
    {
        foreach (var u in updates)
        {
            if (u.slotIndex < 0 || u.slotIndex >= MaxMultiScreenSlots) continue;
            var vv = _msVideoViews[u.slotIndex];
            if (vv == null) continue;
            if (!_msSlotActive[u.slotIndex] || !u.visible || u.w <= 10 || u.h <= 10)
            {
                vv.Visible = false;
                continue;
            }
            vv.SetBounds(u.x, u.y, u.w, u.h);
            vv.Visible = true;
            vv.BringToFront();
        }
    }

    private void ClearMultiScreenSlot(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= MaxMultiScreenSlots) return;
        _msSlotActive[slotIndex] = false;
        _msSlotFallbacks[slotIndex] = Array.Empty<string>();
        _msSlotFallbackIndex[slotIndex] = 0;
        try
        {
            _msPlayers[slotIndex]?.Stop();
            if (_msVideoViews[slotIndex] is { } vv)
            {
                vv.Visible = false;
            }
        }
        catch { }
    }

    private void ClearAllMultiScreenSlots()
    {
        for (int i = 0; i < MaxMultiScreenSlots; i++)
        {
            ClearMultiScreenSlot(i);
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
            _fullscreenTimer?.Stop();
            _vlcFullscreenHudVisible = false;
            UpdateCenterPlayOverlay(false);
            if (_btnVlcTools != null) _btnVlcTools.Visible = false;
            if (_pnlVlcToolsMenu != null) _pnlVlcToolsMenu.Visible = false;
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

            var audioOpts = new List<VlcTrackOption>();
            var audioList = new List<object>();
            if (audioDescs != null)
            {
                foreach (var t in audioDescs)
                {
                    audioList.Add(new { id = t.Id, name = t.Name });
                    audioOpts.Add(new VlcTrackOption { Id = t.Id, Name = string.IsNullOrWhiteSpace(t.Name) ? LocalizationService.Get("VlcAudioDefault") : t.Name });
                }
            }

            var spuOpts = new List<VlcTrackOption>();
            var spuList = new List<object>();
            if (spuDescs != null)
            {
                foreach (var s in spuDescs)
                {
                    spuList.Add(new { id = s.Id, name = s.Name });
                    string label = s.Id == -1 ? LocalizationService.Get("VlcSubtitleNone") : (string.IsNullOrWhiteSpace(s.Name) ? $"#{s.Id}" : s.Name);
                    spuOpts.Add(new VlcTrackOption { Id = s.Id, Name = label });
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
                UpdateNativeTrackSelectors(audioOpts, currentAudio, spuOpts, currentSpu);
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
                EnsureVlcOverlayZOrder();
            }
            ResumeLayout(true);

            ShowExitFullscreenButton();
            RepositionVlcOverlays();
            _webView.CoreWebView2?.ExecuteScriptAsync("document.body.classList.add('desktop-mini-pip');");
        }
        else
        {
            _isPipMode = false;
            if (!_isFullScreen)
            {
                _fullscreenTimer?.Stop();
                _vlcFullscreenHudVisible = false;
            }
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
            RepositionVlcOverlays();

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
            if (_pnlVlcToolsMenu != null) _pnlVlcToolsMenu.Visible = false;
            _lastVlcCursorPos = Cursor.Position;
            _lastVlcActivityTick = Environment.TickCount64;
            _vlcFullscreenHudVisible = true;

            _previousWindowState = WindowState;
            _previousBorderStyle = FormBorderStyle;
            _previousBounds = Bounds;

            SuspendLayout();
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;
            Bounds = Screen.FromControl(this).Bounds;

            _videoView.Dock = DockStyle.Fill;
            _videoView.Visible = true;
            ResumeLayout(true);

            ShowExitFullscreenButton();
            RepositionVlcOverlays();
            EnsureVlcOverlayZOrder();
            _videoView.Focus();
        }
        else
        {
            if (!_isPipMode)
            {
                _fullscreenTimer?.Stop();
                _vlcFullscreenHudVisible = false;
            }
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
            if (_pnlVlcToolsMenu != null)
            {
                _pnlVlcToolsMenu.Visible = false;
            }

            UpdateVideoViewLayout();
            RepositionVlcOverlays();
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
                BackColor = Color.FromArgb(15, 23, 42),
                ForeColor = Color.FromArgb(245, 158, 11),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 20, FontStyle.Bold)
            };
            _btnCenterPlayOverlay.FlatAppearance.BorderSize = 2;
            _btnCenterPlayOverlay.FlatAppearance.BorderColor = Color.FromArgb(245, 158, 11);
            _btnCenterPlayOverlay.Click += (s, e) =>
            {
                _vlcPlayer?.Pause();
                if (_isFullScreen || _isPipMode) ShowExitFullscreenButton();
            };
            Controls.Add(_btnCenterPlayOverlay);
        }

        int cx = _videoView.Left + Math.Max(0, (_videoView.Width - _btnCenterPlayOverlay.Width) / 2);
        int cy = _videoView.Top + Math.Max(0, (_videoView.Height - _btnCenterPlayOverlay.Height) / 2);
        var centerLoc = new Point(cx, cy);
        if (_btnCenterPlayOverlay.Location != centerLoc) _btnCenterPlayOverlay.Location = centerLoc;
        if (!_btnCenterPlayOverlay.Visible) _btnCenterPlayOverlay.Visible = true;
        EnsureVlcOverlayZOrder();
    }

    private void ShowExitFullscreenButton()
    {
        if (!_isFullScreen && !_isPipMode) return;
        _lastVlcActivityTick = Environment.TickCount64;
        _lastVlcCursorPos = Cursor.Position;

        if (_btnExitFullscreen == null)
        {
            _btnExitFullscreen = new Button
            {
                Text = LocalizationService.Get(_isPipMode ? "ExitPipBtn" : "ExitFullscreenBtn"),
                Size = new Size(190, 36),
                BackColor = Color.FromArgb(15, 23, 42), // #0F172A
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

            _fullscreenTimer = new System.Windows.Forms.Timer { Interval = 250 };
            _fullscreenTimer.Tick += (s, e) =>
            {
                if ((!_isFullScreen && !_isPipMode) || !_isVlcActive)
                {
                    _fullscreenTimer.Stop();
                    return;
                }

                var cur = Cursor.Position;
                if (Math.Abs(cur.X - _lastVlcCursorPos.X) >= 3 || Math.Abs(cur.Y - _lastVlcCursorPos.Y) >= 3)
                {
                    _lastVlcCursorPos = cur;
                    _lastVlcActivityTick = Environment.TickCount64;
                    if (!_vlcFullscreenHudVisible)
                    {
                        ShowExitFullscreenButton();
                    }
                    return;
                }

                bool menuOrDropdownOpen = (_pnlVlcToolsMenu != null && _pnlVlcToolsMenu.Visible) ||
                    (_cmbVlcAspect?.DroppedDown == true) ||
                    (_cmbVlcAudio?.DroppedDown == true) ||
                    (_cmbVlcSubtitles?.DroppedDown == true);
                if (menuOrDropdownOpen)
                {
                    _lastVlcActivityTick = Environment.TickCount64;
                    return;
                }

                if (_vlcFullscreenHudVisible && Environment.TickCount64 - _lastVlcActivityTick >= 3000)
                {
                    _vlcFullscreenHudVisible = false;
                    if (_btnExitFullscreen != null && _btnExitFullscreen.Visible)
                    {
                        _btnExitFullscreen.Visible = false;
                    }
                    if (_isFullScreen && _btnVlcTools != null && _btnVlcTools.Visible)
                    {
                        _btnVlcTools.Visible = false;
                    }
                }
            };
        }

        string exitText = LocalizationService.Get(_isPipMode ? "ExitPipBtn" : "ExitFullscreenBtn");
        var exitLoc = new Point(Math.Max(8, ClientSize.Width - _btnExitFullscreen.Width - 16), 12);
        bool needsLayoutSync = !_vlcFullscreenHudVisible || !_btnExitFullscreen.Visible || _btnExitFullscreen.Text != exitText || _btnExitFullscreen.Location != exitLoc;
        _vlcFullscreenHudVisible = true;

        if (_btnExitFullscreen.Text != exitText) _btnExitFullscreen.Text = exitText;
        if (_btnExitFullscreen.Location != exitLoc) _btnExitFullscreen.Location = exitLoc;
        if (!_btnExitFullscreen.Visible) _btnExitFullscreen.Visible = true;

        if (needsLayoutSync)
        {
            RepositionVlcOverlays();
        }
        if (_fullscreenTimer != null && !_fullscreenTimer.Enabled)
        {
            _fullscreenTimer.Start();
        }
    }

    private void ApplyVlcLayout(int x, int y, int width, int height, bool visible)
    {
        if (_videoView == null || !_isVlcActive || _isFullScreen || _isPipMode) return;

        if (!visible || width <= 0 || height <= 0)
        {
            _videoView.Visible = false;
            if (_btnCenterPlayOverlay != null) _btnCenterPlayOverlay.Visible = false;
            RepositionVlcOverlays();
            return;
        }

        _videoView.Dock = DockStyle.None;
        _videoView.SetBounds(x, y, width, height);
        _videoView.Visible = true;
        EnsureVlcOverlayZOrder();
        if (_btnCenterPlayOverlay != null && _btnCenterPlayOverlay.Visible)
        {
            UpdateCenterPlayOverlay(true);
        }
        RepositionVlcOverlays();
    }

    private void EnsureVlcToolsOverlayCreated()
    {
        if (_btnVlcTools != null && _pnlVlcToolsMenu != null) return;

        var darkSurface = Color.FromArgb(15, 23, 42);
        var darkInput = Color.FromArgb(30, 41, 59);
        var amberAccent = Color.FromArgb(245, 158, 11);
        var lightText = Color.FromArgb(240, 246, 252);
        var mutedText = Color.FromArgb(148, 163, 184);

        _btnVlcTools = new Button
        {
            Text = LocalizationService.Get("VlcToolsBtn"),
            Size = new Size(142, 34),
            BackColor = Color.FromArgb(15, 23, 42),
            ForeColor = lightText,
            FlatStyle = FlatStyle.Flat,
            Cursor = Cursors.Hand,
            Font = new Font("Segoe UI", 9, FontStyle.Bold),
            Visible = false
        };
        _btnVlcTools.FlatAppearance.BorderSize = 1;
        _btnVlcTools.FlatAppearance.BorderColor = amberAccent;
        _btnVlcTools.Click += (_, _) => ToggleVlcToolsMenu();
        Controls.Add(_btnVlcTools);

        _pnlVlcToolsMenu = new Panel
        {
            Size = new Size(316, 316),
            BackColor = darkSurface,
            ForeColor = lightText,
            Visible = false
        };
        _pnlVlcToolsMenu.Paint += (_, e) =>
        {
            using var pen = new Pen(amberAccent, 1);
            e.Graphics.DrawRectangle(pen, 0, 0, _pnlVlcToolsMenu.Width - 1, _pnlVlcToolsMenu.Height - 1);
        };

        var lblTitle = new Label
        {
            Text = LocalizationService.Get("VlcToolsTitle"),
            Location = new Point(12, 10),
            Size = new Size(256, 22),
            ForeColor = amberAccent,
            Font = new Font("Segoe UI", 9.5f, FontStyle.Bold)
        };

        var btnCloseMenu = new Button
        {
            Text = LocalizationService.Get("VlcCloseMenu"),
            Location = new Point(274, 8),
            Size = new Size(30, 26),
            BackColor = darkInput,
            ForeColor = lightText,
            FlatStyle = FlatStyle.Flat,
            Cursor = Cursors.Hand,
            Font = new Font("Segoe UI", 8.5f, FontStyle.Bold)
        };
        btnCloseMenu.FlatAppearance.BorderSize = 0;
        btnCloseMenu.Click += (_, _) =>
        {
            _pnlVlcToolsMenu.Visible = false;
            _lastVlcActivityTick = Environment.TickCount64;
        };

        Button MakeActionBtn(string text, int x, int y, int w)
        {
            var btn = new Button
            {
                Text = text,
                Location = new Point(x, y),
                Size = new Size(w, 28),
                BackColor = darkInput,
                ForeColor = lightText,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold)
            };
            btn.FlatAppearance.BorderSize = 1;
            btn.FlatAppearance.BorderColor = Color.FromArgb(51, 65, 85);
            return btn;
        }

        var btnPlayPause = MakeActionBtn(LocalizationService.Get("VlcPlayPause"), 12, 38, 94);
        btnPlayPause.Click += (_, _) => _vlcPlayer?.Pause();

        var btnStop = MakeActionBtn(LocalizationService.Get("VlcStop"), 111, 38, 94);
        btnStop.Click += (_, _) =>
        {
            _pnlVlcToolsMenu.Visible = false;
            StopVlcStream();
            _webView.CoreWebView2?.ExecuteScriptAsync("window.fluiStreamApp?.stopPlayback();");
        };

        var btnPip = MakeActionBtn(LocalizationService.Get("VlcPip"), 210, 38, 94);
        btnPip.Click += (_, _) =>
        {
            _pnlVlcToolsMenu.Visible = false;
            ToggleMiniPlayerPip();
        };

        var btnFs = MakeActionBtn(LocalizationService.Get("VlcFullscreen"), 12, 72, 143);
        btnFs.Click += (_, _) =>
        {
            _pnlVlcToolsMenu.Visible = false;
            ToggleVlcFullscreen();
        };

        var btnClosePlayer = MakeActionBtn(LocalizationService.Get("VlcClose"), 161, 72, 143);
        btnClosePlayer.ForeColor = Color.FromArgb(248, 113, 113);
        btnClosePlayer.Click += (_, _) =>
        {
            _pnlVlcToolsMenu.Visible = false;
            StopVlcStream();
            _webView.CoreWebView2?.ExecuteScriptAsync("window.fluiStreamApp?.closePlayerAndReset();");
        };

        _btnVlcMute = MakeActionBtn(LocalizationService.Get("VlcMute"), 12, 110, 98);
        _btnVlcMute.Click += (_, _) =>
        {
            if (_vlcPlayer == null) return;
            bool nextMuted = !_vlcPlayer.Mute;
            _vlcPlayer.Mute = nextMuted;
            SyncVlcToolsControls();
            double volFrac = Math.Clamp((_vlcPlayer.Volume >= 0 ? _vlcPlayer.Volume : 100) / 100.0, 0.0, 1.0);
            _webView.CoreWebView2?.ExecuteScriptAsync(
                $"window.fluiStreamApp?.handleHardwareVolume({volFrac.ToString(System.Globalization.CultureInfo.InvariantCulture)}, {(nextMuted ? "true" : "false")});"
            );
        };

        _trkVlcVolume = new TrackBar
        {
            Location = new Point(116, 108),
            Size = new Size(188, 34),
            Minimum = 0,
            Maximum = 100,
            TickStyle = TickStyle.None,
            BackColor = darkSurface
        };
        _trkVlcVolume.Scroll += (_, _) =>
        {
            if (_vlcPlayer == null || _suppressVlcTrackEvents) return;
            int vol = _trkVlcVolume.Value;
            _vlcPlayer.Volume = vol;
            if (vol > 0 && _vlcPlayer.Mute) _vlcPlayer.Mute = false;
            SyncVlcToolsControls();
            double volFrac = vol / 100.0;
            _webView.CoreWebView2?.ExecuteScriptAsync(
                $"window.fluiStreamApp?.handleHardwareVolume({volFrac.ToString(System.Globalization.CultureInfo.InvariantCulture)}, {(_vlcPlayer.Mute ? "true" : "false")});"
            );
        };

        var lblAspect = new Label
        {
            Text = LocalizationService.Get("VlcAspectLabel"),
            Location = new Point(12, 148),
            Size = new Size(292, 18),
            ForeColor = mutedText,
            Font = new Font("Segoe UI", 8.5f, FontStyle.Regular)
        };

        _cmbVlcAspect = new ComboBox
        {
            Location = new Point(12, 168),
            Size = new Size(292, 26),
            DropDownStyle = ComboBoxStyle.DropDownList,
            BackColor = darkInput,
            ForeColor = lightText,
            FlatStyle = FlatStyle.Flat
        };
        _cmbVlcAspect.Items.AddRange(new object[]
        {
            new { Tag = "auto", Text = LocalizationService.Get("VlcAspectAuto") },
            new { Tag = "16:9", Text = "16:9" },
            new { Tag = "4:3", Text = "4:3" },
            new { Tag = "fill", Text = LocalizationService.Get("VlcAspectFill") }
        });
        _cmbVlcAspect.DisplayMember = "Text";
        _cmbVlcAspect.SelectedIndex = 0;
        _cmbVlcAspect.SelectedIndexChanged += (_, _) =>
        {
            if (_suppressVlcTrackEvents || _cmbVlcAspect.SelectedItem == null) return;
            string ratio = _cmbVlcAspect.SelectedIndex switch
            {
                1 => "16:9",
                2 => "4:3",
                3 => "fill",
                _ => "auto"
            };
            _vlcAspectRatio = ratio;
            SetVlcAspectRatio(ratio);
            string serialized = System.Text.Json.JsonSerializer.Serialize(ratio);
            _webView.CoreWebView2?.ExecuteScriptAsync($"window.fluiStreamApp?.handleNativeAspectRatio({serialized});");
        };

        var lblAudio = new Label
        {
            Text = LocalizationService.Get("VlcAudioLabel"),
            Location = new Point(12, 202),
            Size = new Size(292, 18),
            ForeColor = mutedText,
            Font = new Font("Segoe UI", 8.5f, FontStyle.Regular)
        };

        _cmbVlcAudio = new ComboBox
        {
            Location = new Point(12, 222),
            Size = new Size(292, 26),
            DropDownStyle = ComboBoxStyle.DropDownList,
            BackColor = darkInput,
            ForeColor = lightText,
            FlatStyle = FlatStyle.Flat
        };
        _cmbVlcAudio.Items.Add(new VlcTrackOption { Id = -1, Name = LocalizationService.Get("VlcAudioDefault") });
        _cmbVlcAudio.SelectedIndex = 0;
        _cmbVlcAudio.SelectedIndexChanged += (_, _) =>
        {
            if (_suppressVlcTrackEvents || _vlcPlayer == null) return;
            if (_cmbVlcAudio.SelectedItem is VlcTrackOption opt)
            {
                _vlcPlayer.SetAudioTrack(opt.Id);
                Task.Delay(120).ContinueWith(_ => BeginInvoke(SendVlcTracksToWeb));
            }
        };

        var lblSubtitles = new Label
        {
            Text = LocalizationService.Get("VlcSubtitleLabel"),
            Location = new Point(12, 256),
            Size = new Size(292, 18),
            ForeColor = mutedText,
            Font = new Font("Segoe UI", 8.5f, FontStyle.Regular)
        };

        _cmbVlcSubtitles = new ComboBox
        {
            Location = new Point(12, 276),
            Size = new Size(292, 26),
            DropDownStyle = ComboBoxStyle.DropDownList,
            BackColor = darkInput,
            ForeColor = lightText,
            FlatStyle = FlatStyle.Flat
        };
        _cmbVlcSubtitles.Items.Add(new VlcTrackOption { Id = -1, Name = LocalizationService.Get("VlcSubtitleNone") });
        _cmbVlcSubtitles.SelectedIndex = 0;
        _cmbVlcSubtitles.SelectedIndexChanged += (_, _) =>
        {
            if (_suppressVlcTrackEvents || _vlcPlayer == null) return;
            if (_cmbVlcSubtitles.SelectedItem is VlcTrackOption opt)
            {
                _vlcPlayer.SetSpu(opt.Id);
                Task.Delay(120).ContinueWith(_ => BeginInvoke(SendVlcTracksToWeb));
            }
        };

        _pnlVlcToolsMenu.Controls.AddRange(new Control[]
        {
            lblTitle, btnCloseMenu,
            btnPlayPause, btnStop, btnPip, btnFs, btnClosePlayer,
            _btnVlcMute, _trkVlcVolume,
            lblAspect, _cmbVlcAspect,
            lblAudio, _cmbVlcAudio,
            lblSubtitles, _cmbVlcSubtitles
        });
        Controls.Add(_pnlVlcToolsMenu);
    }

    private void ToggleVlcToolsMenu()
    {
        if (!_isVlcActive || _videoView == null || !_videoView.Visible || _isPipMode) return;
        EnsureVlcToolsOverlayCreated();
        if (_pnlVlcToolsMenu == null) return;

        _lastVlcActivityTick = Environment.TickCount64;
        _lastVlcCursorPos = Cursor.Position;

        bool nextVisible = !_pnlVlcToolsMenu.Visible;
        if (nextVisible)
        {
            SyncVlcToolsControls();
            SendVlcTracksToWeb();
        }
        _pnlVlcToolsMenu.Visible = nextVisible;
        RepositionVlcOverlays();
    }

    private void SyncVlcToolsControls()
    {
        if (_pnlVlcToolsMenu == null || _vlcPlayer == null) return;
        _suppressVlcTrackEvents = true;
        try
        {
            if (_trkVlcVolume != null)
            {
                int vol = Math.Clamp(_vlcPlayer.Volume >= 0 ? _vlcPlayer.Volume : 100, 0, 100);
                _trkVlcVolume.Value = vol;
            }
            if (_btnVlcMute != null)
            {
                _btnVlcMute.ForeColor = _vlcPlayer.Mute ? Color.FromArgb(245, 158, 11) : Color.FromArgb(240, 246, 252);
            }
            if (_cmbVlcAspect != null)
            {
                _cmbVlcAspect.SelectedIndex = _vlcAspectRatio switch
                {
                    "16:9" => 1,
                    "4:3" => 2,
                    "fill" => 3,
                    _ => 0
                };
            }
        }
        finally
        {
            _suppressVlcTrackEvents = false;
        }
    }

    private void UpdateNativeTrackSelectors(List<VlcTrackOption> audioOpts, int currentAudio, List<VlcTrackOption> spuOpts, int currentSpu)
    {
        if (_cmbVlcAudio == null || _cmbVlcSubtitles == null) return;
        _suppressVlcTrackEvents = true;
        try
        {
            _cmbVlcAudio.Items.Clear();
            if (audioOpts.Count == 0)
            {
                _cmbVlcAudio.Items.Add(new VlcTrackOption { Id = -1, Name = LocalizationService.Get("VlcAudioDefault") });
                _cmbVlcAudio.SelectedIndex = 0;
            }
            else
            {
                int selIdx = 0;
                for (int i = 0; i < audioOpts.Count; i++)
                {
                    _cmbVlcAudio.Items.Add(audioOpts[i]);
                    if (audioOpts[i].Id == currentAudio) selIdx = i;
                }
                _cmbVlcAudio.SelectedIndex = selIdx;
            }

            _cmbVlcSubtitles.Items.Clear();
            if (spuOpts.Count == 0)
            {
                _cmbVlcSubtitles.Items.Add(new VlcTrackOption { Id = -1, Name = LocalizationService.Get("VlcSubtitleNone") });
                _cmbVlcSubtitles.SelectedIndex = 0;
            }
            else
            {
                int selIdx = 0;
                for (int i = 0; i < spuOpts.Count; i++)
                {
                    _cmbVlcSubtitles.Items.Add(spuOpts[i]);
                    if (spuOpts[i].Id == currentSpu) selIdx = i;
                }
                _cmbVlcSubtitles.SelectedIndex = selIdx;
            }
        }
        finally
        {
            _suppressVlcTrackEvents = false;
        }
    }

    private void EnsureVlcOverlayZOrder()
    {
        Control?[] desiredTopDown =
        {
            _pnlVlcToolsMenu,
            _btnExitFullscreen,
            _btnVlcTools,
            _btnCenterPlayOverlay,
            _videoView,
            _webView
        };

        var present = new List<Control>(desiredTopDown.Length);
        foreach (var ctrl in desiredTopDown)
        {
            if (ctrl != null && ctrl.Parent == this)
            {
                present.Add(ctrl);
            }
        }
        if (present.Count < 2) return;

        bool alreadyOrdered = true;
        int prevIdx = -1;
        foreach (var ctrl in present)
        {
            int idx = Controls.GetChildIndex(ctrl, false);
            if (idx <= prevIdx)
            {
                alreadyOrdered = false;
                break;
            }
            prevIdx = idx;
        }
        if (alreadyOrdered) return;

        for (int i = 0; i < present.Count; i++)
        {
            if (Controls.GetChildIndex(present[i], false) != i)
            {
                Controls.SetChildIndex(present[i], i);
            }
        }
    }

    private void RepositionVlcOverlays()
    {
        if (!_isVlcActive || _videoView == null || !_videoView.Visible || _isPipMode || _videoView.Width < 120 || _videoView.Height < 90)
        {
            if (_btnVlcTools != null && _btnVlcTools.Visible) _btnVlcTools.Visible = false;
            if (_pnlVlcToolsMenu != null && _pnlVlcToolsMenu.Visible) _pnlVlcToolsMenu.Visible = false;
            return;
        }

        EnsureVlcToolsOverlayCreated();
        if (_btnVlcTools == null || _pnlVlcToolsMenu == null) return;

        bool exitBtnShown = _isFullScreen && _btnExitFullscreen != null && _btnExitFullscreen.Visible;
        int btnX = exitBtnShown
            ? Math.Max(_videoView.Left + 8, _btnExitFullscreen!.Left - _btnVlcTools.Width - 10)
            : Math.Max(_videoView.Left + 8, _videoView.Right - _btnVlcTools.Width - 14);
        int btnY = _videoView.Top + 12;

        var toolsBtnLoc = new Point(btnX, btnY);
        if (_btnVlcTools.Location != toolsBtnLoc) _btnVlcTools.Location = toolsBtnLoc;

        bool showToolsBtn = !_isFullScreen || _vlcFullscreenHudVisible || _pnlVlcToolsMenu.Visible;
        if (_btnVlcTools.Visible != showToolsBtn) _btnVlcTools.Visible = showToolsBtn;

        int menuX = Math.Clamp(_videoView.Right - _pnlVlcToolsMenu.Width - 14, 8, Math.Max(8, ClientSize.Width - _pnlVlcToolsMenu.Width - 8));
        int menuY = Math.Clamp(_btnVlcTools.Bottom + 6, 8, Math.Max(8, ClientSize.Height - _pnlVlcToolsMenu.Height - 8));
        var menuLoc = new Point(menuX, menuY);
        if (_pnlVlcToolsMenu.Location != menuLoc) _pnlVlcToolsMenu.Location = menuLoc;

        if (_btnCenterPlayOverlay != null && _btnCenterPlayOverlay.Visible)
        {
            int cx = _videoView.Left + Math.Max(0, (_videoView.Width - _btnCenterPlayOverlay.Width) / 2);
            int cy = _videoView.Top + Math.Max(0, (_videoView.Height - _btnCenterPlayOverlay.Height) / 2);
            var centerLoc = new Point(cx, cy);
            if (_btnCenterPlayOverlay.Location != centerLoc) _btnCenterPlayOverlay.Location = centerLoc;
        }

        EnsureVlcOverlayZOrder();
    }

    private async void UpdateVideoViewLayout()
    {
        if (!_isVlcActive || _videoView == null || _webView.CoreWebView2 == null || _isFullScreen || _isPipMode) return;
        try
        {
            // Consulta as dimensões exatas de #player-wrapper respeitando overlays de categorias/modais/cabeçalho fixo
            string script = @"(() => {
                const el = document.getElementById('player-wrapper');
                if (!el) return null;
                const blocked = Boolean(document.querySelector('.modal-backdrop:not(.hidden), .modal:not(.hidden), .dialog-overlay:not(.hidden), [data-modal-open=""true""], #split-sidebar.open-mobile, #sidebar-backdrop:not(.hidden)'));
                const inHidden = Boolean(el.closest('.hidden'));
                const rect = el.getBoundingClientRect();
                const header = document.getElementById('app-header');
                let underHeader = false;
                if (header) {
                    const pos = window.getComputedStyle(header).position;
                    if (pos === 'sticky' || pos === 'fixed') {
                        const hr = header.getBoundingClientRect();
                        if (hr.height > 0 && rect.top < hr.bottom - 2) underHeader = true;
                    }
                }
                const dpr = window.devicePixelRatio || 1;
                return JSON.stringify({
                    x: Math.round(rect.left * dpr),
                    y: Math.round(rect.top * dpr),
                    width: Math.round(rect.width * dpr),
                    height: Math.round(rect.height * dpr),
                    visible: !blocked && !inHidden && !underHeader && rect.width > 0 && rect.height > 0 && rect.bottom > 20 && rect.top < window.innerHeight
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
                RepositionVlcOverlays();
            }
            else
            {
                UpdateVideoViewLayout();
                RepositionVlcOverlays();
            }
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        try
        {
            _localProxyListener?.Stop();
            _localProxyListener?.Close();
            ClearAllMultiScreenSlots();
            for (int i = 0; i < MaxMultiScreenSlots; i++)
            {
                _msPlayers[i]?.Dispose();
                _msPlayers[i] = null;
            }
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

    private static HttpClient CreateProxyHttpClient()
    {
        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = true,
            MaxAutomaticRedirections = 10,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
        };
        return new HttpClient(handler, disposeHandler: true)
        {
            Timeout = Timeout.InfiniteTimeSpan
        };
    }

    private void StartLocalStreamProxy()
    {
        if (_localProxyListener != null && _localProxyListener.IsListening) return;

        for (int port = 5055; port <= 5075; port++)
        {
            var listener = new HttpListener();
            string prefix = $"http://127.0.0.1:{port}/";
            listener.Prefixes.Add(prefix);
            try
            {
                listener.Start();
                _localProxyListener = listener;
                _localProxyBaseUrl = prefix;
                _ = Task.Run(async () =>
                {
                    while (listener.IsListening)
                    {
                        try
                        {
                            var ctx = await listener.GetContextAsync().ConfigureAwait(false);
                            _ = Task.Run(() => HandleLocalProxyRequestAsync(ctx));
                        }
                        catch (HttpListenerException)
                        {
                            break;
                        }
                        catch (ObjectDisposedException)
                        {
                            break;
                        }
                        catch
                        {
                            // Keep listener alive on transient accept errors
                        }
                    }
                });
                return;
            }
            catch
            {
                try { listener.Close(); } catch { }
            }
        }
    }

    private async Task HandleLocalProxyRequestAsync(HttpListenerContext ctx)
    {
        var res = ctx.Response;
        res.Headers["Access-Control-Allow-Origin"] = "*";
        res.Headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
        res.Headers["Access-Control-Allow-Headers"] = "*";
        res.Headers["Access-Control-Expose-Headers"] = "Content-Length, Content-Range, Content-Type";

        try
        {
            if (string.Equals(ctx.Request.HttpMethod, "OPTIONS", StringComparison.OrdinalIgnoreCase))
            {
                res.StatusCode = 204;
                res.Close();
                return;
            }

            if (string.Equals(ctx.Request.Url?.AbsolutePath, "/health", StringComparison.OrdinalIgnoreCase))
            {
                res.ContentType = "application/json; charset=utf-8";
                string payload = System.Text.Json.JsonSerializer.Serialize(new
                {
                    status = "ok",
                    mode = "desktop-webview",
                    proxyUrl = _localProxyBaseUrl
                });
                byte[] okBytes = Encoding.UTF8.GetBytes(payload);
                res.ContentLength64 = okBytes.Length;
                await res.OutputStream.WriteAsync(okBytes, 0, okBytes.Length).ConfigureAwait(false);
                res.Close();
                return;
            }

            if (!string.Equals(ctx.Request.Url?.AbsolutePath, "/proxy", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(ctx.Request.Url?.AbsolutePath, "/api/proxy", StringComparison.OrdinalIgnoreCase))
            {
                res.StatusCode = 404;
                res.Close();
                return;
            }

            string? rawUrl = ctx.Request.QueryString["url"];
            if (string.IsNullOrWhiteSpace(rawUrl)
                || !Uri.TryCreate(rawUrl, UriKind.Absolute, out var targetUri)
                || (targetUri.Scheme != Uri.UriSchemeHttp && targetUri.Scheme != Uri.UriSchemeHttps))
            {
                res.StatusCode = 400;
                res.Close();
                return;
            }

            using var req = new HttpRequestMessage(
                string.Equals(ctx.Request.HttpMethod, "HEAD", StringComparison.OrdinalIgnoreCase) ? HttpMethod.Head : HttpMethod.Get,
                targetUri
            );
            req.Headers.TryAddWithoutValidation("User-Agent", "IPTVSmartersPro/3.1.5 (Linux;Android 11) VLC/3.0.20");
            req.Headers.TryAddWithoutValidation("Accept", "*/*");
            string? rangeHeader = ctx.Request.Headers["Range"];
            if (!string.IsNullOrWhiteSpace(rangeHeader))
            {
                req.Headers.TryAddWithoutValidation("Range", rangeHeader);
            }

            using var connectCts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            using var upstreamRes = await _proxyHttpClient
                .SendAsync(req, HttpCompletionOption.ResponseHeadersRead, connectCts.Token)
                .ConfigureAwait(false);

            res.StatusCode = (int)upstreamRes.StatusCode;
            Uri finalUri = upstreamRes.RequestMessage?.RequestUri ?? targetUri;
            string mediaType = upstreamRes.Content.Headers.ContentType?.MediaType ?? "";

            bool isBinaryMedia = mediaType.Contains("mp2t", StringComparison.OrdinalIgnoreCase)
                || mediaType.Contains("video/mp4", StringComparison.OrdinalIgnoreCase)
                || mediaType.Contains("octet-stream", StringComparison.OrdinalIgnoreCase) && finalUri.AbsolutePath.EndsWith(".ts", StringComparison.OrdinalIgnoreCase);

            bool looksLikeM3u8 = !isBinaryMedia && (
                mediaType.Contains("mpegurl", StringComparison.OrdinalIgnoreCase)
                || finalUri.AbsolutePath.EndsWith(".m3u8", StringComparison.OrdinalIgnoreCase)
                || targetUri.AbsolutePath.EndsWith(".m3u8", StringComparison.OrdinalIgnoreCase)
            );

            long? contentLen = upstreamRes.Content.Headers.ContentLength;
            if (looksLikeM3u8 && (!contentLen.HasValue || contentLen.Value <= 4 * 1024 * 1024))
            {
                string bodyText = await upstreamRes.Content.ReadAsStringAsync(connectCts.Token).ConfigureAwait(false);
                if (bodyText.TrimStart().StartsWith("#EXTM3U", StringComparison.OrdinalIgnoreCase))
                {
                    string rewritten = RewriteM3u8Manifest(bodyText, finalUri);
                    byte[] bytes = Encoding.UTF8.GetBytes(rewritten);
                    res.ContentType = "application/vnd.apple.mpegurl; charset=utf-8";
                    res.ContentLength64 = bytes.Length;
                    await res.OutputStream.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
                }
                else
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(bodyText);
                    if (!string.IsNullOrEmpty(mediaType)) res.ContentType = mediaType;
                    res.ContentLength64 = bytes.Length;
                    await res.OutputStream.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
                }
                res.Close();
                return;
            }

            if (upstreamRes.Content.Headers.ContentType != null)
            {
                res.ContentType = upstreamRes.Content.Headers.ContentType.ToString();
            }
            if (contentLen.HasValue && contentLen.Value >= 0)
            {
                res.ContentLength64 = contentLen.Value;
            }
            if (upstreamRes.Content.Headers.ContentRange != null)
            {
                res.Headers["Content-Range"] = upstreamRes.Content.Headers.ContentRange.ToString();
            }

            await using var upstreamStream = await upstreamRes.Content.ReadAsStreamAsync(connectCts.Token).ConfigureAwait(false);
            byte[] buffer = new byte[65536];
            int bytesRead;
            while ((bytesRead = await upstreamStream.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) > 0)
            {
                await res.OutputStream.WriteAsync(buffer, 0, bytesRead).ConfigureAwait(false);
                await res.OutputStream.FlushAsync().ConfigureAwait(false);
            }
            res.Close();
        }
        catch (OperationCanceledException)
        {
            try
            {
                res.StatusCode = 504;
                res.Close();
            }
            catch { }
        }
        catch
        {
            try
            {
                res.StatusCode = 502;
                res.Close();
            }
            catch { }
        }
    }

    private string RewriteM3u8Manifest(string manifestContent, Uri baseUri)
    {
        var lines = manifestContent.Replace("\r\n", "\n").Split('\n');
        var sb = new StringBuilder(manifestContent.Length + 256);

        for (int i = 0; i < lines.Length; i++)
        {
            string line = lines[i];
            if (string.IsNullOrWhiteSpace(line))
            {
                if (i < lines.Length - 1) sb.Append('\n');
                continue;
            }

            if (line.StartsWith('#'))
            {
                line = Regex.Replace(line, @"URI=""([^""]+)""", m =>
                {
                    string raw = m.Groups[1].Value;
                    if (raw.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return m.Value;
                    if (Uri.TryCreate(baseUri, raw, out var resolved) && (resolved.Scheme == Uri.UriSchemeHttp || resolved.Scheme == Uri.UriSchemeHttps))
                    {
                        return $"URI=\"{_localProxyBaseUrl}proxy?url={Uri.EscapeDataString(resolved.ToString())}\"";
                    }
                    return m.Value;
                });
                sb.Append(line);
            }
            else
            {
                string trimmed = line.Trim();
                if (Uri.TryCreate(baseUri, trimmed, out var resolved) && (resolved.Scheme == Uri.UriSchemeHttp || resolved.Scheme == Uri.UriSchemeHttps))
                {
                    sb.Append($"{_localProxyBaseUrl}proxy?url={Uri.EscapeDataString(resolved.ToString())}");
                }
                else
                {
                    sb.Append(line);
                }
            }

            if (i < lines.Length - 1) sb.Append('\n');
        }

        return sb.ToString();
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

