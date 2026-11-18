#if !WINDOWS
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Photino.NET;

namespace FluiStream.Desktop;

public static class CrossPlatformHost
{
    private static readonly HttpClient HttpClient = new(new HttpClientHandler
    {
        AutomaticDecompression = DecompressionMethods.All,
        AllowAutoRedirect = true,
        MaxAutomaticRedirections = 10,
        ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
    })
    {
        Timeout = Timeout.InfiniteTimeSpan
    };

    private static readonly object _externalUrlLock = new();
    private static string _lastExternalUrl = "";
    private static long _lastExternalUrlTick = 0;

    private static string GetAppVersion()
    {
        return Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.2.0";
    }

    private static string GetHostPlatform()
    {
        return OperatingSystem.IsMacOS() ? "macos" : (OperatingSystem.IsLinux() ? "linux" : "windows");
    }

    public static void OpenExternalUrl(string? rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl)) return;
        if (!Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return;
        }

        string safeUrl = uri.ToString();
        lock (_externalUrlLock)
        {
            long now = Environment.TickCount64;
            if (string.Equals(safeUrl, _lastExternalUrl, StringComparison.Ordinal) && (now - _lastExternalUrlTick) < 800)
            {
                return;
            }
            _lastExternalUrl = safeUrl;
            _lastExternalUrlTick = now;
        }

        try
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
            {
                var psi = new ProcessStartInfo("open")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                psi.ArgumentList.Add(safeUrl);
                Process.Start(psi);

                if (uri.AbsolutePath.EndsWith(".dmg", StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        var notifyPsi = new ProcessStartInfo("osascript")
                        {
                            UseShellExecute = false,
                            CreateNoWindow = true
                        };
                        notifyPsi.ArgumentList.Add("-e");
                        notifyPsi.ArgumentList.Add("display notification \"Download do novo DMG iniciado no navegador. Abra o arquivo .dmg baixado e arraste o FluiStream para Aplicativos.\" with title \"FluiStream\"");
                        Process.Start(notifyPsi);
                    }
                    catch { }
                }
            }
            else if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                var psi = new ProcessStartInfo("xdg-open")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                psi.ArgumentList.Add(safeUrl);
                Process.Start(psi);
            }
            else
            {
                Process.Start(new ProcessStartInfo(safeUrl) { UseShellExecute = true });
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[FluiStream] Erro ao abrir URL externa ({safeUrl}): {ex.Message}");
        }
    }

    private static class MacNative
    {
        [DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_getClass")]
        public static extern IntPtr objc_getClass(string className);

        [DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "sel_registerName")]
        public static extern IntPtr sel_registerName(string selectorName);

        [DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
        public static extern IntPtr objc_msgSend(IntPtr receiver, IntPtr selector);

        [DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
        public static extern IntPtr objc_msgSend_IntPtr(IntPtr receiver, IntPtr selector, IntPtr arg);

        [DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
        public static extern IntPtr objc_msgSend_ULong(IntPtr receiver, IntPtr selector, ulong arg);

        [DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
        public static extern ulong objc_msgSend_RetULong(IntPtr receiver, IntPtr selector);

        public static IntPtr GetNSWindow(PhotinoWindow window)
        {
            try
            {
                var field = typeof(PhotinoWindow).GetField("_nativeInstance", BindingFlags.NonPublic | BindingFlags.Instance);
                if (field == null) return IntPtr.Zero;
                IntPtr nativeInstance = (IntPtr)field.GetValue(window)!;
                if (nativeInstance == IntPtr.Zero) return IntPtr.Zero;
                return Marshal.ReadIntPtr(nativeInstance + 0xc8);
            }
            catch
            {
                return IntPtr.Zero;
            }
        }

        public static bool IsInFullScreen(IntPtr nsWindow)
        {
            if (nsWindow == IntPtr.Zero) return false;
            try
            {
                var selStyleMask = sel_registerName("styleMask");
                ulong styleMask = objc_msgSend_RetULong(nsWindow, selStyleMask);
                const ulong NSWindowStyleMaskFullScreen = 1UL << 14;
                return (styleMask & NSWindowStyleMaskFullScreen) != 0;
            }
            catch
            {
                return false;
            }
        }

        public static void SetupNativeFullScreenSupport(IntPtr nsWindow)
        {
            if (nsWindow == IntPtr.Zero) return;
            try
            {
                var selGetBehavior = sel_registerName("collectionBehavior");
                var selSetBehavior = sel_registerName("setCollectionBehavior:");
                ulong behavior = objc_msgSend_RetULong(nsWindow, selGetBehavior);
                const ulong NSWindowCollectionBehaviorFullScreenPrimary = 1UL << 7;
                objc_msgSend_ULong(nsWindow, selSetBehavior, behavior | NSWindowCollectionBehaviorFullScreenPrimary);

                RestorePresentationOptions();
            }
            catch { }
        }

        public static void RestorePresentationOptions()
        {
            try
            {
                var nsAppCls = objc_getClass("NSApplication");
                if (nsAppCls != IntPtr.Zero)
                {
                    var selSharedApp = sel_registerName("sharedApplication");
                    var nsApp = objc_msgSend(nsAppCls, selSharedApp);
                    if (nsApp != IntPtr.Zero)
                    {
                        var selSetOptions = sel_registerName("setPresentationOptions:");
                        objc_msgSend_ULong(nsApp, selSetOptions, 0);
                    }
                }
            }
            catch { }
        }

        public static bool ToggleFullScreen(IntPtr nsWindow, bool? enter = null)
        {
            if (nsWindow == IntPtr.Zero) return false;
            try
            {
                bool isFs = IsInFullScreen(nsWindow);
                if (enter.HasValue && enter.Value == isFs)
                {
                    RestorePresentationOptions();
                    return isFs;
                }

                SetupNativeFullScreenSupport(nsWindow);
                var selToggle = sel_registerName("toggleFullScreen:");
                objc_msgSend_IntPtr(nsWindow, selToggle, IntPtr.Zero);
                RestorePresentationOptions();
                return !isFs;
            }
            catch
            {
                return false;
            }
        }
    }

    public static void Run(string[] args)
    {
        int port = 5055;
        for (int i = 0; i < 10; i++)
        {
            try
            {
                var listener = new HttpListener();
                listener.Prefixes.Add($"http://localhost:{port}/");
                listener.Prefixes.Add($"http://127.0.0.1:{port}/");
                listener.Start();

                string url = $"http://127.0.0.1:{port}/";
                PrintBanner(url);

                Action<string>? onWindowCommand = null;
                _ = Task.Run(() => ListenLoop(listener, url, cmd => onWindowCommand?.Invoke(cmd)));

                bool isHeadless = Array.Exists(args, a => a.Equals("--headless", StringComparison.OrdinalIgnoreCase) || a.Equals("--no-gui", StringComparison.OrdinalIgnoreCase))
                    || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("FLUI_HEADLESS"));

                bool guiLaunched = false;
                if (!isHeadless)
                {
                    try
                    {
                        var iconPath = Path.Combine(AppContext.BaseDirectory, "app.ico");
                        var window = new PhotinoWindow()
                            .SetTitle("FluiStream")
                            .SetSize(1280, 720)
                            .SetMinSize(960, 540)
                            .Center();

                        bool isFullScreenMode = false;
                        bool isPlayerFullscreen = false;
                        bool appWasFullscreenBeforePlayer = false;
                        bool isPipMode = false;
                        Size prePipSize = new Size(1280, 720);
                        Point prePipLocation = new Point(100, 100);
                        long lastWindowCmdTick = 0;
                        string lastWindowCmd = "";

                        void HandleWindowCommand(string action)
                        {
                            try
                            {
                                window.Invoke(() =>
                                {
                                    long now = Environment.TickCount64;
                                    if (string.Equals(action, lastWindowCmd, StringComparison.OrdinalIgnoreCase) && (now - lastWindowCmdTick) < 300)
                                    {
                                        return;
                                    }
                                    lastWindowCmdTick = now;
                                    lastWindowCmd = action;

                                    if (string.Equals(action, "ENTER_FULLSCREEN", StringComparison.OrdinalIgnoreCase) ||
                                        (string.Equals(action, "TOGGLE_FULLSCREEN", StringComparison.OrdinalIgnoreCase) && !isPlayerFullscreen))
                                    {
                                        if (isPipMode)
                                        {
                                            isPipMode = false;
                                            window.SetTopMost(false);
                                            window.SetMinSize(960, 540);
                                            if (prePipSize.Width > 0 && prePipSize.Height > 0)
                                                window.SetSize(prePipSize);
                                            if (prePipLocation.X > 0 && prePipLocation.Y > 0)
                                                window.SetLocation(prePipLocation);
                                        }

                                        isPlayerFullscreen = true;
                                        IntPtr nsWin = OperatingSystem.IsMacOS() ? MacNative.GetNSWindow(window) : IntPtr.Zero;
                                        bool alreadyFs = OperatingSystem.IsMacOS() && nsWin != IntPtr.Zero
                                            ? MacNative.IsInFullScreen(nsWin)
                                            : isFullScreenMode;

                                        appWasFullscreenBeforePlayer = alreadyFs;

                                        if (!alreadyFs)
                                        {
                                            isFullScreenMode = true;
                                            if (OperatingSystem.IsMacOS() && nsWin != IntPtr.Zero)
                                            {
                                                MacNative.ToggleFullScreen(nsWin, true);
                                            }
                                            else
                                            {
                                                window.SetFullScreen(true);
                                            }
                                        }

                                        Console.WriteLine("[FluiStream] Janela: Player FullScreen ativado");
                                    }
                                    else if (string.Equals(action, "EXIT_FULLSCREEN", StringComparison.OrdinalIgnoreCase) ||
                                             (string.Equals(action, "TOGGLE_FULLSCREEN", StringComparison.OrdinalIgnoreCase) && isPlayerFullscreen))
                                    {
                                        isPlayerFullscreen = false;
                                        IntPtr nsWin = OperatingSystem.IsMacOS() ? MacNative.GetNSWindow(window) : IntPtr.Zero;
                                        if (!appWasFullscreenBeforePlayer)
                                        {
                                            isFullScreenMode = false;
                                            if (OperatingSystem.IsMacOS() && nsWin != IntPtr.Zero)
                                            {
                                                MacNative.ToggleFullScreen(nsWin, false);
                                            }
                                            else
                                            {
                                                window.SetFullScreen(false);
                                            }
                                        }
                                        appWasFullscreenBeforePlayer = false;

                                        if (OperatingSystem.IsMacOS())
                                        {
                                            MacNative.RestorePresentationOptions();
                                        }

                                        try { window.SendWebMessage($"{{\"type\":\"WINDOW_STATE\",\"isFullscreen\":false,\"isPip\":{isPipMode.ToString().ToLowerInvariant()}}}"); } catch { }
                                        Console.WriteLine("[FluiStream] Janela: Player FullScreen encerrado");
                                    }
                                    else if (string.Equals(action, "ENTER_PIP", StringComparison.OrdinalIgnoreCase) ||
                                             (string.Equals(action, "TOGGLE_PIP", StringComparison.OrdinalIgnoreCase) && !isPipMode))
                                    {
                                        if (!isPipMode)
                                        {
                                            IntPtr nsWin = OperatingSystem.IsMacOS() ? MacNative.GetNSWindow(window) : IntPtr.Zero;
                                            if (isFullScreenMode || (OperatingSystem.IsMacOS() && nsWin != IntPtr.Zero && MacNative.IsInFullScreen(nsWin)))
                                            {
                                                isFullScreenMode = false;
                                                if (OperatingSystem.IsMacOS() && nsWin != IntPtr.Zero)
                                                    MacNative.ToggleFullScreen(nsWin, false);
                                                else
                                                    window.SetFullScreen(false);
                                            }

                                            prePipSize = window.Size;
                                            prePipLocation = window.Location;
                                            isPipMode = true;

                                            window.SetTopMost(true);
                                            window.SetMinSize(320, 180);
                                            window.SetSize(420, 240);

                                            try
                                            {
                                                var mon = window.MainMonitor;
                                                if (mon.WorkArea.Width > 0)
                                                {
                                                    int targetX = Math.Max(24, mon.WorkArea.X + mon.WorkArea.Width - 420 - 24);
                                                    int targetY = Math.Max(24, mon.WorkArea.Y + 24);
                                                    window.SetLocation(new Point(targetX, targetY));
                                                }
                                            }
                                            catch { }

                                            try { window.SendWebMessage("{\"type\":\"WINDOW_STATE\",\"isFullscreen\":false,\"isPip\":true}"); } catch { }
                                            Console.WriteLine("[FluiStream] Janela: Picture-in-Picture ativado (420x240, TopMost)");
                                        }
                                    }
                                    else if (string.Equals(action, "EXIT_PIP", StringComparison.OrdinalIgnoreCase) ||
                                             (string.Equals(action, "TOGGLE_PIP", StringComparison.OrdinalIgnoreCase) && isPipMode))
                                    {
                                        if (isPipMode)
                                        {
                                            isPipMode = false;
                                            window.SetTopMost(false);
                                            window.SetMinSize(960, 540);
                                            if (prePipSize.Width > 0 && prePipSize.Height > 0)
                                                window.SetSize(prePipSize);
                                            if (prePipLocation.X > 0 && prePipLocation.Y > 0)
                                                window.SetLocation(prePipLocation);

                                            try { window.SendWebMessage("{\"type\":\"WINDOW_STATE\",\"isFullscreen\":false,\"isPip\":false}"); } catch { }
                                            Console.WriteLine("[FluiStream] Janela: Picture-in-Picture desativado (tamanho restaurado)");
                                        }
                                    }
                                });
                            }
                            catch (Exception ex)
                            {
                                Console.WriteLine($"[FluiStream] Erro ao manipular comando de janela ({action}): {ex.Message}");
                            }
                        }

                        onWindowCommand = HandleWindowCommand;

                        window.RegisterWebMessageReceivedHandler((sender, rawMsg) =>
                        {
                            if (string.IsNullOrWhiteSpace(rawMsg)) return;
                            try
                            {
                                if (rawMsg.Contains("OPEN_URL", StringComparison.OrdinalIgnoreCase))
                                {
                                    using var doc = System.Text.Json.JsonDocument.Parse(rawMsg);
                                    string? msgAction = doc.RootElement.TryGetProperty("action", out var actEl) ? actEl.GetString() : null;
                                    string? msgType = doc.RootElement.TryGetProperty("type", out var typeEl) ? typeEl.GetString() : null;
                                    if (string.Equals(msgAction, "OPEN_URL", StringComparison.OrdinalIgnoreCase) ||
                                        string.Equals(msgType, "OPEN_URL", StringComparison.OrdinalIgnoreCase))
                                    {
                                        if (doc.RootElement.TryGetProperty("url", out var urlEl))
                                        {
                                            OpenExternalUrl(urlEl.GetString());
                                        }
                                        return;
                                    }
                                }

                                string action = "";
                                if (rawMsg.Contains("ENTER_FULLSCREEN", StringComparison.OrdinalIgnoreCase)) action = "ENTER_FULLSCREEN";
                                else if (rawMsg.Contains("EXIT_FULLSCREEN", StringComparison.OrdinalIgnoreCase)) action = "EXIT_FULLSCREEN";
                                else if (rawMsg.Contains("TOGGLE_FULLSCREEN", StringComparison.OrdinalIgnoreCase)) action = "TOGGLE_FULLSCREEN";
                                else if (rawMsg.Contains("ENTER_PIP", StringComparison.OrdinalIgnoreCase)) action = "ENTER_PIP";
                                else if (rawMsg.Contains("EXIT_PIP", StringComparison.OrdinalIgnoreCase)) action = "EXIT_PIP";
                                else if (rawMsg.Contains("TOGGLE_PIP", StringComparison.OrdinalIgnoreCase)) action = "TOGGLE_PIP";

                                if (!string.IsNullOrEmpty(action))
                                {
                                    HandleWindowCommand(action);
                                }
                            }
                            catch { }
                        });

                        if (File.Exists(iconPath))
                        {
                            try { window.SetIconFile(iconPath); } catch { }
                        }

                        if (OperatingSystem.IsMacOS())
                        {
                            try
                            {
                                MacNative.RestorePresentationOptions();
                            }
                            catch { }

                            window.RegisterWindowCreatedHandler((sender, e) =>
                            {
                                try
                                {
                                    var nsWin = MacNative.GetNSWindow(window);
                                    MacNative.SetupNativeFullScreenSupport(nsWin);
                                }
                                catch { }
                            });

                            window.RegisterSizeChangedHandler((sender, size) =>
                            {
                                try
                                {
                                    var nsWin = MacNative.GetNSWindow(window);
                                    if (nsWin != IntPtr.Zero)
                                    {
                                        bool isFs = MacNative.IsInFullScreen(nsWin);
                                        isFullScreenMode = isFs;
                                        // Se a janela saiu de tela cheia do SO e o player estava em tela cheia exclusiva,
                                        // sincroniza a saída do player. NUNCA força o player a entrar em tela cheia só porque o app está maximizado.
                                        if (!isFs && isPlayerFullscreen)
                                        {
                                            isPlayerFullscreen = false;
                                            appWasFullscreenBeforePlayer = false;
                                            try { window.SendWebMessage($"{{\"type\":\"WINDOW_STATE\",\"isFullscreen\":false,\"isPip\":{isPipMode.ToString().ToLowerInvariant()}}}"); } catch { }
                                        }
                                    }
                                }
                                catch { }
                            });
                        }

                        window.Load(new Uri(url));
                        guiLaunched = true;
                        window.WaitForClose();
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[FluiStream] Interface gráfica nativa (WKWebView/Photino) indisponível ({ex.Message}). Alternando para navegador.");
                        guiLaunched = false;
                    }
                }

                if (!guiLaunched && !isHeadless)
                {
                    OpenBrowser(url);
                }

                if (!guiLaunched)
                {
                    var cts = new CancellationTokenSource();
                    Console.CancelKeyPress += (s, e) =>
                    {
                        e.Cancel = true;
                        cts.Cancel();
                    };

                    try
                    {
                        Task.Delay(Timeout.Infinite, cts.Token).GetAwaiter().GetResult();
                    }
                    catch (TaskCanceledException)
                    {
                    }
                }

                listener.Stop();
                Console.WriteLine("\n[FluiStream] Encerrado com sucesso.");
                return;
            }
            catch (HttpListenerException)
            {
                port++;
            }
        }

        Console.Error.WriteLine("[FluiStream] Erro: Não foi possível abrir porta local entre 5055 e 5065.");
    }

    public static Task RunAsync(string[] args)
    {
        Run(args);
        return Task.CompletedTask;
    }

    private static void PrintBanner(string url)
    {
        string version = GetAppVersion();
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("====================================================");
        Console.WriteLine($"   FluiStream v{version} — Desktop Portable Runner      ");
        Console.WriteLine("   Padrão Cesar Ovies Engineering Standards         ");
        Console.WriteLine("====================================================");
        Console.ResetColor();
        Console.WriteLine($"\n[FluiStream] Servidor local ativo em: {url}");
        Console.WriteLine("[FluiStream] Pressione Ctrl+C para encerrar.\n");
    }

    private static async Task ListenLoop(HttpListener listener, string baseUrl, Action<string>? onWindowCommand = null)
    {
        string baseDir = AppContext.BaseDirectory;
        string webRoot = Path.Combine(baseDir, "web");
        if (!Directory.Exists(webRoot))
        {
            string macAppWeb = Path.GetFullPath(Path.Combine(baseDir, "..", "Resources", "web"));
            if (Directory.Exists(macAppWeb)) webRoot = macAppWeb;
        }
        if (!Directory.Exists(webRoot))
        {
            string devWeb = Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "web"));
            if (Directory.Exists(devWeb)) webRoot = devWeb;
        }

        while (listener.IsListening)
        {
            try
            {
                var ctx = await listener.GetContextAsync();
                _ = Task.Run(() => HandleRequest(ctx, webRoot, baseUrl, onWindowCommand));
            }
            catch
            {
                if (!listener.IsListening) break;
            }
        }
    }

    private static async Task HandleRequest(HttpListenerContext ctx, string webRoot, string baseUrl, Action<string>? onWindowCommand = null)
    {
        try
        {
            var req = ctx.Request;
            var res = ctx.Response;

            res.Headers.Add("Access-Control-Allow-Origin", "*");
            res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
            res.Headers.Add("Access-Control-Allow-Headers", "*");
            res.Headers.Add("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type");

            if (req.HttpMethod.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            {
                res.StatusCode = 204;
                res.Close();
                return;
            }

            string path = req.Url?.AbsolutePath ?? "/";
            string originBase = !string.IsNullOrEmpty(req.Url?.Authority)
                ? $"{req.Url.Scheme}://{req.Url.Authority}/"
                : baseUrl;

            if (path.Equals("/health", StringComparison.OrdinalIgnoreCase))
            {
                res.ContentType = "application/json; charset=utf-8";
                string payload = System.Text.Json.JsonSerializer.Serialize(new
                {
                    status = "ok",
                    mode = "cross-platform-host",
                    version = GetAppVersion(),
                    platform = GetHostPlatform(),
                    proxyUrl = originBase
                });
                byte[] okBytes = Encoding.UTF8.GetBytes(payload);
                res.ContentLength64 = okBytes.Length;
                await res.OutputStream.WriteAsync(okBytes);
                res.Close();
                return;
            }

            if (path.Equals("/api/window", StringComparison.OrdinalIgnoreCase))
            {
                string? action = req.QueryString["action"];
                string? targetUrl = req.QueryString["url"];
                if (req.HasEntityBody)
                {
                    using var reader = new StreamReader(req.InputStream, req.ContentEncoding);
                    string body = await reader.ReadToEndAsync();
                    if (!string.IsNullOrWhiteSpace(body))
                    {
                        try
                        {
                            using var doc = System.Text.Json.JsonDocument.Parse(body);
                            if (string.IsNullOrWhiteSpace(action) && doc.RootElement.TryGetProperty("action", out var actEl))
                            {
                                action = actEl.GetString();
                            }
                            if (string.IsNullOrWhiteSpace(targetUrl) && doc.RootElement.TryGetProperty("url", out var urlEl))
                            {
                                targetUrl = urlEl.GetString();
                            }
                        }
                        catch
                        {
                            if (string.IsNullOrWhiteSpace(action))
                            {
                                if (body.Contains("ENTER_FULLSCREEN", StringComparison.OrdinalIgnoreCase)) action = "ENTER_FULLSCREEN";
                                else if (body.Contains("EXIT_FULLSCREEN", StringComparison.OrdinalIgnoreCase)) action = "EXIT_FULLSCREEN";
                                else if (body.Contains("TOGGLE_FULLSCREEN", StringComparison.OrdinalIgnoreCase)) action = "TOGGLE_FULLSCREEN";
                                else if (body.Contains("ENTER_PIP", StringComparison.OrdinalIgnoreCase)) action = "ENTER_PIP";
                                else if (body.Contains("EXIT_PIP", StringComparison.OrdinalIgnoreCase)) action = "EXIT_PIP";
                                else if (body.Contains("TOGGLE_PIP", StringComparison.OrdinalIgnoreCase)) action = "TOGGLE_PIP";
                            }
                        }
                    }
                }

                if (string.Equals(action, "OPEN_URL", StringComparison.OrdinalIgnoreCase))
                {
                    OpenExternalUrl(targetUrl);
                }
                else if (!string.IsNullOrWhiteSpace(action))
                {
                    onWindowCommand?.Invoke(action);
                }

                res.ContentType = "application/json; charset=utf-8";
                byte[] okBytes = Encoding.UTF8.GetBytes("{\"ok\":true}");
                res.ContentLength64 = okBytes.Length;
                await res.OutputStream.WriteAsync(okBytes);
                res.Close();
                return;
            }

            if (path.Equals("/api/proxy", StringComparison.OrdinalIgnoreCase) || path.Equals("/proxy", StringComparison.OrdinalIgnoreCase))
            {
                string? targetUrl = req.QueryString["url"];
                if (string.IsNullOrWhiteSpace(targetUrl))
                {
                    var rawQuery = req.Url?.Query;
                    if (!string.IsNullOrEmpty(rawQuery) && rawQuery.Length > 1)
                    {
                        var rawCandidate = Uri.UnescapeDataString(rawQuery.Substring(1)).Trim().TrimStart('/');
                        if (rawCandidate.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                            rawCandidate.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                        {
                            targetUrl = rawCandidate;
                        }
                    }
                }

                if (!string.IsNullOrWhiteSpace(targetUrl))
                {
                    targetUrl = targetUrl.Trim();
                    while (targetUrl.StartsWith('/') || targetUrl.StartsWith("%2F", StringComparison.OrdinalIgnoreCase))
                    {
                        if (targetUrl.StartsWith('/'))
                            targetUrl = targetUrl.TrimStart('/');
                        else if (targetUrl.StartsWith("%2F", StringComparison.OrdinalIgnoreCase))
                            targetUrl = targetUrl.Substring(3);
                    }
                    if (targetUrl.StartsWith("http%3A", StringComparison.OrdinalIgnoreCase) ||
                        targetUrl.StartsWith("https%3A", StringComparison.OrdinalIgnoreCase))
                    {
                        targetUrl = Uri.UnescapeDataString(targetUrl);
                    }
                }

                if (string.IsNullOrWhiteSpace(targetUrl)
                    || !Uri.TryCreate(targetUrl, UriKind.Absolute, out var targetUri)
                    || (targetUri.Scheme != Uri.UriSchemeHttp && targetUri.Scheme != Uri.UriSchemeHttps))
                {
                    res.StatusCode = 400;
                    byte[] err = Encoding.UTF8.GetBytes("Query 'url' válida (http/https) é obrigatória.");
                    await res.OutputStream.WriteAsync(err);
                    res.Close();
                    return;
                }

                try
                {
                    using var proxyReq = new HttpRequestMessage(
                        string.Equals(req.HttpMethod, "HEAD", StringComparison.OrdinalIgnoreCase) ? HttpMethod.Head : HttpMethod.Get,
                        targetUri
                    );
                    proxyReq.Headers.TryAddWithoutValidation("User-Agent", "IPTVSmartersPro/3.1.5 (Linux;Android 11) VLC/3.0.20");
                    proxyReq.Headers.TryAddWithoutValidation("Accept", "*/*");
                    string? rangeHeader = req.Headers["Range"];
                    if (!string.IsNullOrWhiteSpace(rangeHeader))
                    {
                        proxyReq.Headers.TryAddWithoutValidation("Range", rangeHeader);
                    }

                    using var connectCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                    using var proxyRes = await HttpClient
                        .SendAsync(proxyReq, HttpCompletionOption.ResponseHeadersRead, connectCts.Token)
                        .ConfigureAwait(false);

                    res.StatusCode = (int)proxyRes.StatusCode;
                    Uri finalUri = proxyRes.RequestMessage?.RequestUri ?? targetUri;
                    string mediaType = proxyRes.Content.Headers.ContentType?.MediaType ?? "";

                    bool isBinaryMedia = mediaType.Contains("mp2t", StringComparison.OrdinalIgnoreCase)
                        || mediaType.Contains("video/mp4", StringComparison.OrdinalIgnoreCase)
                        || (mediaType.Contains("octet-stream", StringComparison.OrdinalIgnoreCase) && finalUri.AbsolutePath.EndsWith(".ts", StringComparison.OrdinalIgnoreCase));

                    bool looksLikeM3u8 = !isBinaryMedia && (
                        mediaType.Contains("mpegurl", StringComparison.OrdinalIgnoreCase)
                        || finalUri.AbsolutePath.EndsWith(".m3u8", StringComparison.OrdinalIgnoreCase)
                        || targetUri.AbsolutePath.EndsWith(".m3u8", StringComparison.OrdinalIgnoreCase)
                    );

                    long? contentLen = proxyRes.Content.Headers.ContentLength;
                    if (looksLikeM3u8 && (!contentLen.HasValue || contentLen.Value <= 4 * 1024 * 1024))
                    {
                        string bodyText = await proxyRes.Content.ReadAsStringAsync().ConfigureAwait(false);
                        if (bodyText.TrimStart().StartsWith("#EXTM3U", StringComparison.OrdinalIgnoreCase))
                        {
                            string rewritten = RewriteM3u8Manifest(bodyText, finalUri, originBase);
                            byte[] m3uBytes = Encoding.UTF8.GetBytes(rewritten);
                            res.ContentType = "application/vnd.apple.mpegurl; charset=utf-8";
                            res.ContentLength64 = m3uBytes.Length;
                            await res.OutputStream.WriteAsync(m3uBytes, 0, m3uBytes.Length).ConfigureAwait(false);
                        }
                        else
                        {
                            byte[] txtBytes = Encoding.UTF8.GetBytes(bodyText);
                            if (!string.IsNullOrEmpty(mediaType)) res.ContentType = mediaType;
                            res.ContentLength64 = txtBytes.Length;
                            await res.OutputStream.WriteAsync(txtBytes, 0, txtBytes.Length).ConfigureAwait(false);
                        }
                        res.Close();
                        return;
                    }

                    if (proxyRes.Content.Headers.ContentType != null)
                    {
                        res.ContentType = proxyRes.Content.Headers.ContentType.ToString();
                    }
                    if (contentLen.HasValue && contentLen.Value >= 0)
                    {
                        res.ContentLength64 = contentLen.Value;
                    }
                    if (proxyRes.Content.Headers.ContentRange != null)
                    {
                        res.Headers["Content-Range"] = proxyRes.Content.Headers.ContentRange.ToString();
                    }

                    await using var upstreamStream = await proxyRes.Content.ReadAsStreamAsync().ConfigureAwait(false);
                    byte[] buffer = new byte[65536];
                    int bytesRead;
                    while ((bytesRead = await upstreamStream.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) > 0)
                    {
                        await res.OutputStream.WriteAsync(buffer, 0, bytesRead).ConfigureAwait(false);
                        await res.OutputStream.FlushAsync().ConfigureAwait(false);
                    }
                    res.Close();
                    return;
                }
                catch (OperationCanceledException)
                {
                    res.StatusCode = 504;
                    res.Close();
                    return;
                }
                catch (Exception ex)
                {
                    res.StatusCode = 502;
                    byte[] err = Encoding.UTF8.GetBytes($"Proxy error: {ex.Message}");
                    await res.OutputStream.WriteAsync(err);
                    res.Close();
                    return;
                }
            }

            if (path == "/" || string.IsNullOrEmpty(path)) path = "/index.html";
            string relativePath = path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            string fullPath = Path.Combine(webRoot, relativePath);

            if (!File.Exists(fullPath))
            {
                res.StatusCode = 404;
                byte[] notFound = Encoding.UTF8.GetBytes("404 Not Found");
                await res.OutputStream.WriteAsync(notFound);
                res.Close();
                return;
            }

            string ext = Path.GetExtension(fullPath).ToLowerInvariant();
            res.ContentType = ext switch
            {
                ".html" => "text/html; charset=utf-8",
                ".js" or ".mjs" => "application/javascript; charset=utf-8",
                ".css" => "text/css; charset=utf-8",
                ".json" => "application/json; charset=utf-8",
                ".webmanifest" => "application/manifest+json; charset=utf-8",
                ".svg" => "image/svg+xml",
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".ico" => "image/x-icon",
                ".m3u" or ".m3u8" => "application/x-mpegURL",
                ".ts" => "video/mp2t",
                ".mp4" => "video/mp4",
                _ => "application/octet-stream"
            };

            if (path.Equals("/index.html", StringComparison.OrdinalIgnoreCase))
            {
                string html = await File.ReadAllTextAsync(fullPath, Encoding.UTF8);
                string versionJson = System.Text.Json.JsonSerializer.Serialize(GetAppVersion());
                string platformJson = System.Text.Json.JsonSerializer.Serialize(GetHostPlatform());
                string inject = $"<script>window.__fluiLocalProxyUrl = window.location.origin + '/'; window.__fluiLocalHostApp = true; window.__fluiAppVersion = {versionJson}; window.__fluiHostPlatform = {platformJson};</script></head>";
                if (html.Contains("</head>", StringComparison.OrdinalIgnoreCase))
                {
                    html = Regex.Replace(html, "</head>", inject, RegexOptions.IgnoreCase);
                }
                byte[] htmlBytes = Encoding.UTF8.GetBytes(html);
                res.ContentLength64 = htmlBytes.Length;
                await res.OutputStream.WriteAsync(htmlBytes);
                res.Close();
                return;
            }

            using var fs = File.OpenRead(fullPath);
            res.ContentLength64 = fs.Length;
            await fs.CopyToAsync(res.OutputStream);
            res.Close();
        }
        catch
        {
            try { ctx.Response.Abort(); } catch { }
        }
    }

    private static string RewriteM3u8Manifest(string manifestContent, Uri baseUri, string proxyOriginBase)
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
                        return $"URI=\"{proxyOriginBase}proxy?url={Uri.EscapeDataString(resolved.ToString())}\"";
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
                    sb.Append($"{proxyOriginBase}proxy?url={Uri.EscapeDataString(resolved.ToString())}");
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

    private static void OpenBrowser(string url)
    {
        try
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                try
                {
                    Process.Start(new ProcessStartInfo("google-chrome", $"--app={url} --window-size=1280,720") { UseShellExecute = true });
                    return;
                }
                catch { }

                try
                {
                    Process.Start(new ProcessStartInfo("chromium", $"--app={url} --window-size=1280,720") { UseShellExecute = true });
                    return;
                }
                catch { }

                Process.Start(new ProcessStartInfo("xdg-open", url) { UseShellExecute = true });
            }
            else if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
            {
                string chromePath = Directory.Exists("/Applications/Google Chrome.app")
                    ? "/Applications/Google Chrome.app"
                    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Applications", "Google Chrome.app");

                if (Directory.Exists(chromePath))
                {
                    try
                    {
                        using var p = Process.Start(new ProcessStartInfo("open", $"-a \"{chromePath}\" --args --app={url} --window-size=1280,720") { UseShellExecute = true });
                        if (p != null) return;
                    }
                    catch { }
                }

                try
                {
                    Process.Start(new ProcessStartInfo("open", url) { UseShellExecute = true });
                }
                catch { }
            }
            else
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[FluiStream] Abra o navegador em: {url} ({ex.Message})");
        }
    }
}
#endif
