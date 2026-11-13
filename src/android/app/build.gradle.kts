plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun resolveAndroidVersionName(): String {
    val prop = providers.gradleProperty("versionName").orNull?.trim()
    val csproj = rootProject.file("../desktop/FluiStream.Desktop.csproj")
    val fromCsproj = if (prop.isNullOrEmpty() && csproj.exists()) {
        Regex("<Version>\\s*([^<\\s]+)\\s*</Version>").find(csproj.readText())?.groupValues?.get(1)
    } else {
        null
    }
    val raw = (prop?.takeIf { it.isNotEmpty() } ?: fromCsproj ?: "1.1.0")
        .trim()
        .removePrefix("v")
        .removePrefix("V")
    return raw.ifEmpty { "1.1.0" }
}

fun computeAndroidVersionCode(verName: String): Int {
    val explicit = providers.gradleProperty("versionCode").orNull?.trim()?.toIntOrNull()
    if (explicit != null && explicit > 0) return explicit

    val core = verName.substringBefore('-').substringBefore('+')
    val parts = core.split('.').mapNotNull { it.toIntOrNull() }
    val major = parts.getOrElse(0) { 1 }.coerceIn(0, 2000)
    val minor = parts.getOrElse(1) { 0 }.coerceIn(0, 999)
    val patch = parts.getOrElse(2) { 0 }.coerceIn(0, 999)
    return maxOf((major * 1_000_000) + (minor * 1_000) + patch, 2)
}

val resolvedVersionName = resolveAndroidVersionName()
val resolvedVersionCode = computeAndroidVersionCode(resolvedVersionName)

android {
    namespace = "com.cesarovies.fluistream"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.cesarovies.fluistream"
        minSdk = 24
        targetSdk = 34
        versionCode = resolvedVersionCode
        versionName = resolvedVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Fallback to debug signing for reproducible CI builds unless release keystore is configured
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // AndroidX & WebView AssetLoader
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("com.google.android.material:material:1.12.0")

    // AndroidX Media3 (ExoPlayer) for HLS, DASH, and MPEG-TS/progressive IPTV streams
    implementation("androidx.media3:media3-exoplayer:1.3.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.3.1")
    implementation("androidx.media3:media3-exoplayer-dash:1.3.1")
    implementation("androidx.media3:media3-ui:1.3.1")
    implementation("androidx.media3:media3-common:1.3.1")
}
