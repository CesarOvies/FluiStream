using System;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;

namespace FluiStream.Desktop;

[ComVisible(true)]
[ClassInterface(ClassInterfaceType.AutoDual)]
public class NativeBridge
{
    private static readonly HttpClientHandler _handler = new()
    {
        AutomaticDecompression = System.Net.DecompressionMethods.All,
        ServerCertificateCustomValidationCallback = (sender, cert, chain, sslPolicyErrors) => true
    };

    private static readonly HttpClient _httpClient = new(_handler)
    {
        Timeout = TimeSpan.FromSeconds(60)
    };

    public string FetchText(string url)
    {
        return FetchTextAsync(url).GetAwaiter().GetResult();
    }

    public async Task<string> FetchTextAsync(string url)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            throw new ArgumentException("URL cannot be empty", nameof(url));
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("User-Agent", "IPTVSmartersPro/3.1.5 (Linux;Android 11) VLC/3.0.20");
        request.Headers.TryAddWithoutValidation("Accept", "*/*");
        using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseContentRead);
        response.EnsureSuccessStatusCode();

        byte[] bytes = await response.Content.ReadAsByteArrayAsync();
        // Detecção de stream comprimido GZip (magic bytes 0x1F, 0x8B) ou URL .gz
        if ((bytes.Length >= 2 && bytes[0] == 0x1F && bytes[1] == 0x8B) || url.EndsWith(".gz", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                using var ms = new MemoryStream(bytes);
                using var gz = new GZipStream(ms, CompressionMode.Decompress);
                using var reader = new StreamReader(gz, Encoding.UTF8);
                return await reader.ReadToEndAsync();
            }
            catch
            {
                // Fallback para string padrão se não for GZip válido
            }
        }

        return Encoding.UTF8.GetString(bytes);
    }
}

