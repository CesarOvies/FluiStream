# Preserve @JavascriptInterface methods on NativeBridge for R8/ProGuard release builds
-keepattributes JavascriptInterface

-keep class com.cesarovies.fluistream.NativeBridge {
    *;
}

-keepclassmembers class com.cesarovies.fluistream.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
