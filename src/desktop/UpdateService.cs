using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace FluiStream.Desktop;

public static class UpdateService
{
    private static readonly Lazy<HttpClient> LazyClient = new(() =>
    {
        var client = new HttpClient();
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("FluiStream", "1.1"));
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github.v3+json"));
        client.Timeout = TimeSpan.FromSeconds(15);
        return client;
    });

    private static readonly ConcurrentDictionary<string, (string SumsUrl, string AssetName)> PendingChecksums =
        new(StringComparer.OrdinalIgnoreCase);

    private static readonly ConcurrentDictionary<string, string> VerifiedFileHashes =
        new(StringComparer.OrdinalIgnoreCase);

    public static string GetCurrentRuntimeIdentifier()
    {
        if (OperatingSystem.IsWindows())
            return "win-x64";
        if (OperatingSystem.IsLinux())
            return RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "linux-arm64" : "linux-x64";
        if (OperatingSystem.IsMacOS())
            return "osx-arm64";
        return "win-x64";
    }

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

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var root = doc.RootElement;

            string? tagName = root.GetProperty("tag_name").GetString();
            string? body = root.TryGetProperty("body", out var b) ? b.GetString() : null;
            string currentVer = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.1.0";

            if (IsNewerVersion(tagName, currentVer))
            {
                string targetRid = GetCurrentRuntimeIdentifier();
                string? zipDownloadUrl = null;
                string? zipAssetName = null;
                string? tarDownloadUrl = null;
                string? tarAssetName = null;
                string? sha256SumsUrl = null;

                if (root.TryGetProperty("assets", out var assets) && assets.GetArrayLength() > 0)
                {
                    foreach (var asset in assets.EnumerateArray())
                    {
                        string? name = asset.GetProperty("name").GetString();
                        string? browserUrl = asset.GetProperty("browser_download_url").GetString();
                        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(browserUrl)) continue;

                        if (name.Equals("SHA256SUMS.txt", StringComparison.OrdinalIgnoreCase))
                        {
                            sha256SumsUrl = browserUrl;
                        }
                        else if (name.Contains(targetRid, StringComparison.OrdinalIgnoreCase))
                        {
                            if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) && zipDownloadUrl is null)
                            {
                                zipDownloadUrl = browserUrl;
                                zipAssetName = name;
                            }
                            else if (!OperatingSystem.IsWindows() &&
                                     name.EndsWith(".tar.gz", StringComparison.OrdinalIgnoreCase) &&
                                     tarDownloadUrl is null)
                            {
                                tarDownloadUrl = browserUrl;
                                tarAssetName = name;
                            }
                        }
                    }
                }

                string? downloadUrl = zipDownloadUrl ?? tarDownloadUrl;
                string? assetName = zipAssetName ?? tarAssetName;

                if (!string.IsNullOrEmpty(downloadUrl) &&
                    !string.IsNullOrEmpty(assetName) &&
                    !string.IsNullOrEmpty(sha256SumsUrl))
                {
                    PendingChecksums[downloadUrl] = (sha256SumsUrl, assetName);
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

    public static string? ParseSha256FromSums(string sumsContent, string assetName)
    {
        if (string.IsNullOrWhiteSpace(sumsContent) || string.IsNullOrWhiteSpace(assetName))
            return null;

        string targetName = Path.GetFileName(assetName);
        foreach (string rawLine in sumsContent.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            string line = rawLine.Trim().TrimStart('\uFEFF');
            if (string.IsNullOrEmpty(line) || line.StartsWith('#')) continue;

            string[] parts = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2) continue;

            string hash = parts[0].Trim();
            string file = Path.GetFileName(parts[^1].Trim().TrimStart('*'));
            if (file.Equals(targetName, StringComparison.OrdinalIgnoreCase) && hash.Length == 64)
            {
                return hash;
            }
        }

        return null;
    }

    public static async Task<string> ComputeFileSha256Async(string filePath, CancellationToken ct = default)
    {
        using var sha256 = SHA256.Create();
        await using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
        byte[] hash = await sha256.ComputeHashAsync(fs, ct);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    public static string ComputeFileSha256(string filePath)
    {
        using var sha256 = SHA256.Create();
        using var fs = File.OpenRead(filePath);
        byte[] hash = sha256.ComputeHash(fs);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    public static async Task VerifyFileSha256Async(string filePath, string expectedSha256, CancellationToken ct = default)
    {
        string actual = await ComputeFileSha256Async(filePath, ct);
        if (!string.Equals(actual, expectedSha256.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException(
                $"{LocalizationService.Get("UpdateHashMismatch")} (Expected: {expectedSha256.ToLowerInvariant()}, Actual: {actual})");
        }
    }

    public static async Task VerifyFileWithSumsUrlAsync(
        string filePath,
        string sha256SumsUrl,
        string assetName,
        CancellationToken ct = default)
    {
        using var sumsResponse = await LazyClient.Value.GetAsync(sha256SumsUrl, ct);
        if (!sumsResponse.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"{LocalizationService.Get("UpdateHashFetchError")} (HTTP {(int)sumsResponse.StatusCode})");
        }

        string sumsContent = await sumsResponse.Content.ReadAsStringAsync(ct);
        string? expectedHash = ParseSha256FromSums(sumsContent, assetName);
        if (string.IsNullOrEmpty(expectedHash))
        {
            throw new InvalidDataException($"{LocalizationService.Get("UpdateHashMissing")} ({assetName})");
        }

        await VerifyFileSha256Async(filePath, expectedHash, ct);
        VerifiedFileHashes[Path.GetFullPath(filePath)] = expectedHash;
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

        await using (Stream source = await response.Content.ReadAsStreamAsync(ct))
        await using (FileStream dest = new(destinationFilePath, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true))
        {
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

        if (PendingChecksums.TryGetValue(downloadUrl, out var checksumInfo))
        {
            try
            {
                await VerifyFileWithSumsUrlAsync(destinationFilePath, checksumInfo.SumsUrl, checksumInfo.AssetName, ct);
            }
            catch
            {
                try { if (File.Exists(destinationFilePath)) File.Delete(destinationFilePath); } catch { }
                throw;
            }
        }
    }

    public static void ApplyUpdateAndRestart(string zipFilePath, string? expectedSha256 = null)
    {
        string fullArchivePath = Path.GetFullPath(zipFilePath);
        string? hashToVerify = !string.IsNullOrWhiteSpace(expectedSha256)
            ? expectedSha256.Trim()
            : (VerifiedFileHashes.TryGetValue(fullArchivePath, out var recordedHash) ? recordedHash : null);

        if (!string.IsNullOrEmpty(hashToVerify))
        {
            string actual = ComputeFileSha256(fullArchivePath);
            if (!string.Equals(actual, hashToVerify, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException(
                    $"{LocalizationService.Get("UpdateHashMismatch")} (Expected: {hashToVerify.ToLowerInvariant()}, Actual: {actual})");
            }
        }

        string targetExe = Environment.ProcessPath ?? throw new InvalidOperationException();
        string targetDir = Path.GetDirectoryName(targetExe)!;
        string tempRoot = Path.Combine(Path.GetTempPath(), "FluiStream_Update", Guid.NewGuid().ToString("N"));
        string extractDir = Path.Combine(tempRoot, "extracted");
        Directory.CreateDirectory(extractDir);

        ZipFile.ExtractToDirectory(fullArchivePath, extractDir, overwriteFiles: true);

        int currentPid = Environment.ProcessId;

        if (OperatingSystem.IsWindows())
        {
            string psExtract = extractDir.Replace("'", "''");
            string psTargetDir = targetDir.Replace("'", "''");
            string psTargetExe = targetExe.Replace("'", "''");
            string psTempRoot = tempRoot.Replace("'", "''");

            string script = string.Join("; ",
                $"Wait-Process -Id {currentPid} -ErrorAction SilentlyContinue",
                "Start-Sleep -Milliseconds 600",
                $"Copy-Item -Path '{psExtract}\\*' -Destination '{psTargetDir}' -Recurse -Force",
                $"Start-Process -FilePath '{psTargetExe}'",
                $"Remove-Item -Path '{psTempRoot}' -Recurse -Force -ErrorAction SilentlyContinue");

            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -WindowStyle Hidden -Command \"{script}\"",
                UseShellExecute = false,
                CreateNoWindow = true
            };
            Process.Start(psi);
        }
        else
        {
            string shScript =
                $"while kill -0 {currentPid} 2>/dev/null; do sleep 0.2; done; " +
                $"cp -rf \"{extractDir}/.\" \"{targetDir}/\" && " +
                $"chmod +x \"{targetExe}\" && " +
                $"nohup \"{targetExe}\" >/dev/null 2>&1 & " +
                $"rm -rf \"{tempRoot}\"";

            var psi = new ProcessStartInfo
            {
                FileName = "/bin/sh",
                Arguments = $"-c '{shScript.Replace("'", "'\\''")}'",
                UseShellExecute = false,
                CreateNoWindow = true
            };
            Process.Start(psi);
        }

        Environment.Exit(0);
    }
}
