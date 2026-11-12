using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace FluiStream.Desktop;

#if !WINDOWS
public static class CrossPlatformHost
{
    private static readonly HttpClient HttpClient = new(new HttpClientHandler
    {
        AutomaticDecompression = DecompressionMethods.All,
        AllowAutoRedirect = true
    })
    {
        Timeout = TimeSpan.FromSeconds(30)
    };

    public static async Task RunAsync(string[] args)
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

                string url = $"http://localhost:{port}/";
                PrintBanner(url);

                _ = Task.Run(() => ListenLoop(listener));
                OpenBrowser(url);

                var cts = new CancellationTokenSource();
                Console.CancelKeyPress += (s, e) =>
                {
                    e.Cancel = true;
                    cts.Cancel();
                };

                try
                {
                    await Task.Delay(Timeout.Infinite, cts.Token);
                }
                catch (TaskCanceledException)
                {
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

    private static void PrintBanner(string url)
    {
        string version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.1.0";
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("====================================================");
        Console.WriteLine($"   FluiStream v{version} — Desktop Portable Runner      ");
        Console.WriteLine("   Padrão Cesar Ovies Engineering Standards         ");
        Console.WriteLine("====================================================");
        Console.ResetColor();
        Console.WriteLine($"\n[FluiStream] Servidor local ativo em: {url}");
        Console.WriteLine("[FluiStream] Pressione Ctrl+C para encerrar.\n");
    }

    private static async Task ListenLoop(HttpListener listener)
    {
        string baseDir = AppContext.BaseDirectory;
        string webRoot = Path.Combine(baseDir, "web");
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
                _ = Task.Run(() => HandleRequest(ctx, webRoot));
            }
            catch
            {
                if (!listener.IsListening) break;
            }
        }
    }

    private static async Task HandleRequest(HttpListenerContext ctx, string webRoot)
    {
        try
        {
            var req = ctx.Request;
            var res = ctx.Response;

            res.Headers.Add("Access-Control-Allow-Origin", "*");
            res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
            res.Headers.Add("Access-Control-Allow-Headers", "*");

            if (req.HttpMethod.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            {
                res.StatusCode = 204;
                res.Close();
                return;
            }

            string path = req.Url?.AbsolutePath ?? "/";

            if (path.Equals("/api/proxy", StringComparison.OrdinalIgnoreCase) || path.Equals("/proxy", StringComparison.OrdinalIgnoreCase))
            {
                string? targetUrl = req.QueryString["url"];
                if (string.IsNullOrWhiteSpace(targetUrl))
                {
                    res.StatusCode = 400;
                    byte[] err = Encoding.UTF8.GetBytes("Query 'url' é obrigatória.");
                    await res.OutputStream.WriteAsync(err);
                    res.Close();
                    return;
                }

                try
                {
                    using var proxyReq = new HttpRequestMessage(HttpMethod.Get, targetUrl);
                    proxyReq.Headers.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) FluiStream/1.1");
                    using var proxyRes = await HttpClient.SendAsync(proxyReq, HttpCompletionOption.ResponseHeadersRead);

                    res.StatusCode = (int)proxyRes.StatusCode;
                    res.ContentType = proxyRes.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";

                    await proxyRes.Content.CopyToAsync(res.OutputStream);
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

    private static void OpenBrowser(string url)
    {
        try
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                try
                {
                    Process.Start(new ProcessStartInfo("google-chrome", $"--app={url}") { UseShellExecute = true });
                    return;
                }
                catch { }

                try
                {
                    Process.Start(new ProcessStartInfo("chromium", $"--app={url}") { UseShellExecute = true });
                    return;
                }
                catch { }

                Process.Start(new ProcessStartInfo("xdg-open", url) { UseShellExecute = true });
            }
            else if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
            {
                try
                {
                    Process.Start(new ProcessStartInfo("open", $"-a \"Google Chrome\" --args --app={url}") { UseShellExecute = true });
                    return;
                }
                catch { }

                Process.Start(new ProcessStartInfo("open", url) { UseShellExecute = true });
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
