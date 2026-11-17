package com.cesarovies.fluistream

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.ui.PlayerView
import androidx.webkit.WebViewAssetLoader
import android.util.Log
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

class MainActivity : AppCompatActivity() {

    internal val trustAllHostnameVerifier by lazy {
        HostnameVerifier { _, _ -> true }
    }

    internal val trustAllSslSocketFactory by lazy {
        val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
            override fun checkClientTrusted(chain: Array<X509Certificate>?, authType: String?) {}
            override fun checkServerTrusted(chain: Array<X509Certificate>?, authType: String?) {}
        })
        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, trustAllCerts, SecureRandom())
        sslContext.socketFactory
    }

    lateinit var webView: WebView
        private set

    lateinit var videoPlayerManager: VideoPlayerManager
        private set

    lateinit var appUpdateManager: AppUpdateManager
        private set

    private lateinit var tvFocusHelper: TvFocusHelper
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var lastBackPressTimeMs: Long = 0L

    private val installPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        appUpdateManager.onInstallPermissionResult()
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            appUpdateManager.postPendingNotificationIfAny()
        }
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = fileChooserCallback
        fileChooserCallback = null
        if (callback == null) return@registerForActivityResult

        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        callback.onReceiveValue(uris)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        setContentView(R.layout.activity_main)

        runCatching {
            HttpsURLConnection.setDefaultSSLSocketFactory(trustAllSslSocketFactory)
            HttpsURLConnection.setDefaultHostnameVerifier(trustAllHostnameVerifier)
        }

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        @Suppress("DEPRECATION")
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        configureSystemBars()

        webView = findViewById(R.id.web_view)
        val overlayContainer = findViewById<FrameLayout>(R.id.player_overlay_container)
        val playerView = findViewById<PlayerView>(R.id.exo_player_view)
        val topHud = findViewById<LinearLayout>(R.id.player_top_hud)
        val titleText = findViewById<TextView>(R.id.player_title_text)
        val errorText = findViewById<TextView>(R.id.player_error_text)
        val aspectButton = findViewById<Button>(R.id.btn_player_aspect)
        val closeButton = findViewById<Button>(R.id.btn_player_close)
        applyTopHudWindowInsets(topHud)

        videoPlayerManager = VideoPlayerManager(
            context = this,
            overlayContainer = overlayContainer,
            playerView = playerView,
            topHud = topHud,
            titleText = titleText,
            errorText = errorText,
            aspectButton = aspectButton,
            closeButton = closeButton,
            onOpened = {
                configureSystemBars()
            },
            onClosed = {
                configureSystemBars()
                webView.requestFocus()
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('android-player-stopped'));",
                    null
                )
            }
        )

        tvFocusHelper = TvFocusHelper(
            webView = webView,
            videoPlayerManager = videoPlayerManager,
            onBackRequested = { handleBackNavigation() }
        )

        appUpdateManager = AppUpdateManager(
            activity = this,
            requestInstallPermission = { intent -> installPermissionLauncher.launch(intent) },
            requestNotificationPermission = { permission -> notificationPermissionLauncher.launch(permission) }
        )

        setupWebView()
        setupBackDispatcher()
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent?.action == AppUpdateManager.ACTION_PROMPT_UPDATE) {
            appUpdateManager.handleNotificationPromptIntent()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.setBackgroundColor(Color.parseColor("#06101E"))
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = false
            allowContentAccess = true
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val assetResponse = assetLoader.shouldInterceptRequest(request.url)
                if (assetResponse != null) {
                    return assetResponse
                }
                return interceptRemoteHttpRequest(request)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                if (url.host == "appassets.androidplatform.net") {
                    return false
                }
                // Open external links (e.g., GitHub) in system browser
                runCatching {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                }
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback
                return try {
                    val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }
                    fileChooserLauncher.launch(intent)
                    true
                } catch (_: Exception) {
                    fileChooserCallback = null
                    false
                }
            }
        }

        webView.addJavascriptInterface(NativeBridge(this), "androidBridge")
        webView.loadUrl(ASSET_ENTRY_URL)
    }

    fun fetchRemoteTextDirectly(url: String, timeoutMs: Int = 60_000): String {
        var currentUrl = url
        var redirects = 0
        var conn: HttpURLConnection
        val maxRedirects = 5

        while (true) {
            val urlObj = URL(currentUrl)
            conn = (urlObj.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = if (timeoutMs > 0) timeoutMs else 30_000
                readTimeout = if (timeoutMs > 0) timeoutMs else 60_000
                instanceFollowRedirects = false
                setRequestProperty("User-Agent", "IPTVSmartersPro/3.1.5 (Linux;Android 11) VLC/3.0.20")
                setRequestProperty("Accept", "*/*")
                setRequestProperty("Accept-Encoding", "gzip, deflate")
                if (this is HttpsURLConnection) {
                    sslSocketFactory = trustAllSslSocketFactory
                    hostnameVerifier = trustAllHostnameVerifier
                }
            }

            val code = conn.responseCode
            if (code in 301..308 && redirects < maxRedirects) {
                val loc = conn.getHeaderField("Location")
                if (!loc.isNullOrBlank()) {
                    currentUrl = URL(urlObj, loc).toString()
                    redirects++
                    conn.disconnect()
                    continue
                }
            }
            break
        }

        val code = conn.responseCode
        val rawStream = if (code in 200..299) {
            conn.inputStream
        } else {
            val errStream = conn.errorStream
            val errText = errStream?.bufferedReader()?.use { it.readText() }.orEmpty()
            conn.disconnect()
            throw java.io.IOException(if (errText.isNotBlank()) errText else "HTTP $code ${conn.responseMessage.orEmpty()}")
        }

        val contentType = conn.contentType.orEmpty()
        var charset = Charsets.UTF_8
        val charsetIndex = contentType.indexOf("charset=", ignoreCase = true)
        if (charsetIndex != -1) {
            val rawCharset = contentType.substring(charsetIndex + 8).trim('"', '\'', ' ', ';')
            runCatching { charset = java.nio.charset.Charset.forName(rawCharset) }
        }

        val pushback = java.io.PushbackInputStream(java.io.BufferedInputStream(rawStream), 2)
        val head = ByteArray(2)
        val readMagic = pushback.read(head)
        val hasGzipMagic = readMagic == 2 && head[0] == 0x1F.toByte() && head[1] == 0x8B.toByte()
        if (readMagic > 0) {
            pushback.unread(head, 0, readMagic)
        }

        val isGzip = hasGzipMagic ||
                (conn.contentEncoding?.contains("gzip", ignoreCase = true) == true) ||
                url.endsWith(".gz", ignoreCase = true)

        val stream = if (isGzip) {
            java.util.zip.GZIPInputStream(pushback)
        } else {
            pushback
        }

        val reader = java.io.InputStreamReader(stream, charset)
        val sb = StringBuilder()
        val buffer = CharArray(32768)
        try {
            var n: Int
            while (reader.read(buffer).also { n = it } != -1) {
                sb.append(buffer, 0, n)
            }
        } finally {
            reader.close()
            conn.disconnect()
        }

        return sb.toString()
    }

    private fun interceptRemoteHttpRequest(request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url ?: return null
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        if (uri.host == "appassets.androidplatform.net") return null

        val method = request.method ?: "GET"
        if (method.equals("OPTIONS", ignoreCase = true)) {
            val corsHeaders = mapOf(
                "Access-Control-Allow-Origin" to "*",
                "Access-Control-Allow-Methods" to "GET, POST, OPTIONS, HEAD",
                "Access-Control-Allow-Headers" to "*",
                "Access-Control-Allow-Credentials" to "true",
                "Access-Control-Max-Age" to "86400"
            )
            return WebResourceResponse(
                "text/plain",
                "UTF-8",
                204,
                "No Content",
                corsHeaders,
                ByteArrayInputStream(ByteArray(0))
            )
        }

        return runCatching {
            var currentUrl = uri.toString()
            var redirects = 0
            var conn: HttpURLConnection
            while (true) {
                val urlObj = URL(currentUrl)
                conn = (urlObj.openConnection() as HttpURLConnection).apply {
                    requestMethod = method
                    connectTimeout = 30_000
                    readTimeout = 120_000
                    instanceFollowRedirects = false
                    setRequestProperty("User-Agent", "IPTVSmartersPro/3.1.5 (Linux;Android 11) VLC/3.0.20")
                    setRequestProperty("Accept", "*/*")
                    request.requestHeaders?.forEach { (k, v) ->
                        if (!k.equals("Host", ignoreCase = true) &&
                            !k.equals("Origin", ignoreCase = true) &&
                            !k.equals("Accept-Encoding", ignoreCase = true)) {
                            setRequestProperty(k, v)
                        }
                    }
                    setRequestProperty("Accept-Encoding", "gzip, deflate")
                    if (this is HttpsURLConnection) {
                        sslSocketFactory = trustAllSslSocketFactory
                        hostnameVerifier = trustAllHostnameVerifier
                    }
                }

                val code = conn.responseCode
                if (code in 301..308 && redirects < 5) {
                    val loc = conn.getHeaderField("Location")
                    if (!loc.isNullOrBlank()) {
                        currentUrl = URL(urlObj, loc).toString()
                        redirects++
                        conn.disconnect()
                        continue
                    }
                }
                break
            }

            val code = conn.responseCode
            val statusMsg = conn.responseMessage ?: "OK"
            val rawContentType = conn.contentType ?: "application/octet-stream"

            var mimeType = "application/octet-stream"
            var encoding: String? = null
            if (rawContentType.isNotBlank()) {
                val parts = rawContentType.split(";").map { it.trim() }
                if (parts.isNotEmpty()) mimeType = parts[0]
                val charsetPart = parts.find { it.startsWith("charset=", ignoreCase = true) }
                if (charsetPart != null) {
                    encoding = charsetPart.substring(8).trim('"', '\'', ' ')
                }
            }

            val rawStream = if (code in 200..299) {
                conn.inputStream
            } else {
                conn.errorStream ?: ByteArrayInputStream(ByteArray(0))
            }

            val rawEncoding = conn.contentEncoding?.lowercase() ?: ""
            val stream = if (rawEncoding.contains("gzip")) {
                runCatching { java.util.zip.GZIPInputStream(rawStream) }.getOrDefault(rawStream)
            } else if (rawEncoding.contains("deflate")) {
                runCatching { java.util.zip.InflaterInputStream(rawStream) }.getOrDefault(rawStream)
            } else {
                rawStream
            }

            val responseHeaders = mutableMapOf<String, String>()
            conn.headerFields?.forEach { (k, v) ->
                if (k != null && v != null && v.isNotEmpty()) {
                    val lower = k.lowercase()
                    if (lower != "transfer-encoding" &&
                        lower != "content-encoding" &&
                        lower != "content-length" &&
                        lower != "connection" &&
                        lower != "keep-alive" &&
                        !lower.startsWith("access-control-")) {
                        responseHeaders[k] = v.joinToString(", ")
                    }
                }
            }
            responseHeaders["Access-Control-Allow-Origin"] = "*"
            responseHeaders["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, HEAD"
            responseHeaders["Access-Control-Allow-Headers"] = "*"
            responseHeaders["Access-Control-Allow-Credentials"] = "true"

            WebResourceResponse(
                mimeType,
                encoding ?: "UTF-8",
                code,
                statusMsg,
                responseHeaders,
                stream
            )
        }.getOrElse { err ->
            Log.w("FluiStream", "shouldInterceptRequest remote fetch failed for $uri: ${err.message}")
            null
        }
    }

    private fun setupBackDispatcher() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!handleBackNavigation()) {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    private fun handleBackNavigation(): Boolean {
        if (videoPlayerManager.isOverlayVisible()) {
            videoPlayerManager.stop()
            return true
        }

        if (webView.canGoBack()) {
            webView.goBack()
            return true
        }

        // Ask SPA if a modal, sub-view, or category view can be closed via native back handler / fallback selectors
        webView.evaluateJavascript(
            """
            (function() {
              try {
                const nativeResult = (window.fluiStreamApp && typeof window.fluiStreamApp.handleNativeBack === 'function')
                  ? window.fluiStreamApp.handleNativeBack()
                  : null;
                if (nativeResult === true || nativeResult === 'handled') return 'handled';
                if (nativeResult === false || nativeResult === 'root') return 'root';
              } catch (_) {}
              const openModal = document.querySelector('.modal-backdrop:not(.hidden), .seasons-popup-backdrop:not(.hidden)');
              if (openModal) {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                const closeBtn = openModal.querySelector('.modal-close-btn, #btn-close-seasons-popup');
                if (closeBtn) closeBtn.click();
                return 'handled';
              }
              const backCatBtn = document.getElementById('btn-back-categories');
              const catNavBar = document.getElementById('category-nav-bar');
              if (backCatBtn && catNavBar && !catNavBar.classList.contains('hidden')) {
                backCatBtn.click();
                return 'handled';
              }
              return 'root';
            })();
            """.trimIndent()
        ) { result ->
            if (result?.contains("root") == true) {
                val now = SystemClock.elapsedRealtime()
                if (now - lastBackPressTimeMs < BACK_EXIT_WINDOW_MS) {
                    finish()
                } else {
                    lastBackPressTimeMs = now
                    Toast.makeText(
                        this,
                        getString(R.string.tv_back_exit_hint),
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
        }
        return true
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        return when (tvFocusHelper.handleDispatchKeyEvent(event)) {
            TvFocusHelper.KeyEventResult.CONSUMED -> true
            TvFocusHelper.KeyEventResult.PASS_THROUGH -> super.dispatchKeyEvent(event)
        }
    }

    override fun onPause() {
        super.onPause()
        videoPlayerManager.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        webView.onResume()
        configureSystemBars()
    }

    override fun onDestroy() {
        appUpdateManager.release()
        videoPlayerManager.release()
        webView.removeJavascriptInterface("androidBridge")
        webView.destroy()
        super.onDestroy()
    }

    private fun applyTopHudWindowInsets(topHud: LinearLayout) {
        val density = resources.displayMetrics.density
        val baseSide = (16 * density).toInt()
        val baseTop = (10 * density).toInt()
        val baseBottom = (10 * density).toInt()
        ViewCompat.setOnApplyWindowInsetsListener(topHud) { view, windowInsets ->
            val bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())
            val statusIgnoring = windowInsets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.statusBars())
            val cutout = windowInsets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.displayCutout())
            view.setPadding(
                baseSide + maxOf(bars.left, cutout.left),
                baseTop + maxOf(bars.top, statusIgnoring.top, cutout.top),
                baseSide + maxOf(bars.right, cutout.right),
                baseBottom
            )
            windowInsets
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            configureSystemBars()
        }
    }

    private fun configureSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        val topHud = findViewById<LinearLayout?>(R.id.player_top_hud)
        if (topHud != null) {
            topHud.post { ViewCompat.requestApplyInsets(topHud) }
        }
    }

    private fun videoPlayerManagerInitialized(): Boolean = ::videoPlayerManager.isInitialized

    companion object {
        private const val ASSET_ENTRY_URL =
            "https://appassets.androidplatform.net/assets/web/index.html"
        private const val BACK_EXIT_WINDOW_MS = 2000L
    }
}
