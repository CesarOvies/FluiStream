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
        ["ErrorWebView2Body"] = ("O Microsoft Edge WebView2 Runtime é necessário para executar o FluiStream.", "Microsoft Edge WebView2 Runtime is required to run FluiStream.", "El Microsoft Edge WebView2 Runtime es necesario para ejecutar FluiStream.")
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
