using System;
using System.Collections.Generic;
using System.Globalization;

namespace FluiStream.Desktop;

public enum AppLanguage
{
    PtBr,
    EnUs,
    Es
}

public static class LocalizationService
{
    private static AppLanguage _currentLanguage = DetectSystemLanguage();
    public static AppLanguage CurrentLanguage => _currentLanguage;

    public static void SetLanguage(AppLanguage language)
    {
        _currentLanguage = language;
    }

    public static AppLanguage DetectSystemLanguage()
    {
        string name = CultureInfo.CurrentUICulture.Name;
        if (name.StartsWith("en", StringComparison.OrdinalIgnoreCase)) return AppLanguage.EnUs;
        if (name.StartsWith("es", StringComparison.OrdinalIgnoreCase)) return AppLanguage.Es;
        return AppLanguage.PtBr;
    }

    private static readonly Dictionary<string, (string Pt, string En, string Es)> Strings = new()
    {
        ["AppTitle"] = ("FluiStream — Reprodutor M3U, EPG & Xtream Codes", "FluiStream — M3U, EPG & Xtream Codes Player", "FluiStream — Reproductor M3U, EPG & Xtream Codes"),
        ["UpdateAvailableTitle"] = ("Nova Atualização Disponível!", "New Update Available!", "¡Nueva Actualización Disponible!"),
        ["UpdatePrompt"] = ("Uma nova versão do FluiStream está disponível. Deseja atualizar agora?", "A new version of FluiStream is available. Would you like to update now?", "Una nueva versión de FluiStream está disponible. ¿Desea actualizar ahora?"),
        ["BtnUpdate"] = ("Atualizar e Reiniciar", "Update & Restart", "Actualizar y Reiniciar"),
        ["BtnCancel"] = ("Lembrar Depois", "Remind Me Later", "Recordar Más Tarde"),
        ["ErrorWebView2Title"] = ("Componente WebView2 Necessário", "WebView2 Runtime Required", "Componente WebView2 Requerido"),
        ["ErrorWebView2Body"] = ("O Microsoft Edge WebView2 Runtime é necessário para executar o FluiStream.", "Microsoft Edge WebView2 Runtime is required to run FluiStream.", "El Microsoft Edge WebView2 Runtime es necesario para ejecutar FluiStream."),
        ["UpdateDownloading"] = ("Baixando atualização: {0}%", "Downloading update: {0}%", "Descargando actualización: {0}%"),
        ["UpdateHashVerifying"] = ("Verificando integridade SHA-256...", "Verifying SHA-256 integrity...", "Verificando integridad SHA-256..."),
        ["UpdateHashMismatch"] = ("Falha na verificação de segurança SHA-256. Atualização abortada.", "SHA-256 security verification failed. Update aborted.", "Error en la verificación de seguridad SHA-256. Actualización cancelada."),
        ["UpdateHashMissing"] = ("Hash SHA-256 não encontrado em SHA256SUMS.txt para este pacote.", "SHA-256 hash not found in SHA256SUMS.txt for this package.", "Hash SHA-256 no encontrado en SHA256SUMS.txt para este paquete."),
        ["UpdateHashFetchError"] = ("Não foi possível baixar SHA256SUMS.txt para validar a atualização.", "Unable to download SHA256SUMS.txt to validate update.", "No se pudo descargar SHA256SUMS.txt para validar la actualización."),
        ["UpdateApplying"] = ("Substituindo arquivos e reiniciando aplicação...", "Replacing files and restarting application...", "Reemplazando archivos y reiniciando la aplicación..."),
        ["UpdateError"] = ("Erro ao atualizar: {0}", "Update error: {0}", "Error al actualizar: {0}"),
        ["ExitFullscreenBtn"] = ("✕ Sair da Tela Cheia (Esc)", "✕ Exit Fullscreen (Esc)", "✕ Salir de Pantalla Completa (Esc)"),
        ["ExitPipBtn"] = ("↙ Restaurar Player (Esc)", "↙ Restore Player (Esc)", "↙ Restaurar Reproductor (Esc)"),
        ["UpdatePromptHeader"] = ("🚀 Nova Versão Disponível: v{0} → {1}", "🚀 New Version Available: v{0} → {1}", "🚀 Nueva Versión Disponible: v{0} → {1}"),
        ["UpdateNotesFallback"] = ("Melhorias de desempenho, estabilidade na reprodução e atualizações visuais.", "Performance improvements, playback stability, and visual updates.", "Mejoras de rendimiento, estabilidad en la reproducción y actualizaciones visuales.")
    };

    public static string Get(string key)
    {
        if (Strings.TryGetValue(key, out var val))
        {
            return _currentLanguage switch
            {
                AppLanguage.EnUs => val.En,
                AppLanguage.Es => val.Es,
                _ => val.Pt
            };
        }
        return key;
    }
}

