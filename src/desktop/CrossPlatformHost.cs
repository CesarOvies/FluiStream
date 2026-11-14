using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace FluiStream.Desktop;

#if !WINDOWS
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

                _ = Task.Run(() => ListenLoop(listener, url));
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

    private static async Task ListenLoop(HttpListener listener, string baseUrl)
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
                _ = Task.Run(() => HandleRequest(ctx, webRoot, baseUrl));
            }
            catch
            {
                if (!listener.IsListening) break;
            }
        }
    }

    private static async Task HandleRequest(HttpListenerContext ctx, string webRoot, string baseUrl)
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
                    proxyUrl = originBase
                });
                byte[] okBytes = Encoding.UTF8.GetBytes(payload);
                res.ContentLength64 = okBytes.Length;
                await res.OutputStream.WriteAsync(okBytes);
                res.Close();
                return;
            }

            if (path.Equals("/api/proxy", StringComparison.OrdinalIgnoreCase) || path.Equals("/proxy", StringComparison.OrdinalIgnoreCase))
            {
                string? targetUrl = req.QueryString["url"];
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

                    using var connectCts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
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
                        string bodyText = await proxyRes.Content.ReadAsStringAsync(connectCts.Token).ConfigureAwait(false);
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

                    await using var upstreamStream = await proxyRes.Content.ReadAsStreamAsync(connectCts.Token).ConfigureAwait(false);
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
                const string inject = "<script>window.__fluiLocalProxyUrl = window.location.origin + '/'; window.__fluiLocalHostApp = true;</script></head>";
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
