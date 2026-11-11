using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace FluiStream.Desktop;

public static class UpdateService
{
    private static readonly Lazy<HttpClient> LazyClient = new(() =>
    {
        var client = new HttpClient();
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("FluiStream", "1.0"));
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github.v3+json"));
        client.Timeout = TimeSpan.FromSeconds(15);
        return client;
    });

    public static bool TryParseCleanVersion(string? raw, out Version? version)
    {
        version = null;
        if (string.IsNullOrWhiteSpace(raw)) return false;
        string clean = raw.Trim().TrimStart('v', 'V');
        int dashIdx = clean.IndexOfAny(['-', '+']);
        if (dashIdx >= 0) clean = clean[..dashIdx];
        string[] parts = clean.Split('.');
        if (parts.Length == 1 && int.TryParse(parts[0], out int major)) clean = $"{major}.0";
        return Version.TryParse(clean, out version);
    }

    public static bool IsNewerVersion(string? latestTag, string? currentVer)
    {
        if (TryParseCleanVersion(latestTag, out var latest) &&
            TryParseCleanVersion(currentVer, out var current) &&
            latest is not null && current is not null)
        {
            return latest > current;
        }
        return false;
    }

    public static async Task<(bool Available, string? NewVersion, string? DownloadUrl, string? ReleaseNotes)> CheckForUpdatesAsync(CancellationToken ct = default)
    {
        try
        {
            string url = "https://api.github.com/repos/CesarOvies/FluiStream/releases/latest";
            using var response = await LazyClient.Value.GetAsync(url, ct);
            if (!response.IsSuccessStatusCode) return (false, null, null, null);

            var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var root = doc.RootElement;

            string? tagName = root.GetProperty("tag_name").GetString();
            string? body = root.TryGetProperty("body", out var b) ? b.GetString() : null;
            string currentVer = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0";

            if (IsNewerVersion(tagName, currentVer))
            {
                string? downloadUrl = null;
                if (root.TryGetProperty("assets", out var assets) && assets.GetArrayLength() > 0)
                {
                    foreach (var asset in assets.EnumerateArray())
                    {
                        string? name = asset.GetProperty("name").GetString();
                        if (name != null && name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) && name.Contains("win-x64", StringComparison.OrdinalIgnoreCase))
                        {
                            downloadUrl = asset.GetProperty("browser_download_url").GetString();
                            break;
                        }
                    }
                }

                return (true, tagName, downloadUrl, body);
            }
        }
        catch
        {
            // Verificação silenciosa em segundo plano
        }

        return (false, null, null, null);
    }

    public static async Task DownloadUpdateAsync(
        string downloadUrl,
        string destinationFilePath,
        IProgress<int>? progress = null,
        CancellationToken ct = default)
    {
        using HttpResponseMessage response = await LazyClient.Value.GetAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        long? totalBytes = response.Content.Headers.ContentLength;
        string? dir = Path.GetDirectoryName(destinationFilePath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        await using Stream source = await response.Content.ReadAsStreamAsync(ct);
        await using FileStream dest = new(destinationFilePath, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);

        byte[] buffer = new byte[81920];
        long totalRead = 0;
        int read;
        while ((read = await source.ReadAsync(buffer, ct)) > 0)
        {
            await dest.WriteAsync(buffer.AsMemory(0, read), ct);
            totalRead += read;
            if (totalBytes > 0)
            {
                progress?.Report(Math.Clamp((int)Math.Round((double)totalRead / totalBytes.Value * 100), 0, 100));
            }
        }
    }

    public static void ApplyUpdateAndRestart(string zipFilePath)
    {
        string targetExe = Environment.ProcessPath ?? throw new InvalidOperationException();
        string targetDir = Path.GetDirectoryName(targetExe)!;
        string tempRoot = Path.Combine(Path.GetTempPath(), "FluiStream_Update", Guid.NewGuid().ToString("N"));
        string extractDir = Path.Combine(tempRoot, "extracted");
        Directory.CreateDirectory(extractDir);

        ZipFile.ExtractToDirectory(zipFilePath, extractDir, overwriteFiles: true);

        int currentPid = Environment.ProcessId;
        string script = string.Join("; ",
            $"Wait-Process -Id {currentPid} -ErrorAction SilentlyContinue",
            "Start-Sleep -Milliseconds 600",
            $"Copy-Item -Path '{extractDir}\\*' -Destination '{targetDir}' -Recurse -Force",
            $"Start-Process -FilePath '{targetExe}'",
            $"Remove-Item -Path '{tempRoot}' -Recurse -Force -ErrorAction SilentlyContinue");

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoProfile -WindowStyle Hidden -Command \"{script}\"",
            UseShellExecute = false,
            CreateNoWindow = true
        };
        Process.Start(psi);
        Environment.Exit(0);
    }
}

