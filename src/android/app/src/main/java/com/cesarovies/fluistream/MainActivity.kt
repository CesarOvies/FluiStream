package com.cesarovies.fluistream

import android.annotation.SuppressLint
import android.content.Intent
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
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.ui.PlayerView
import androidx.webkit.WebViewAssetLoader

class MainActivity : AppCompatActivity() {

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
        setContentView(R.layout.activity_main)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        configureSystemBars()

        webView = findViewById(R.id.web_view)
        val overlayContainer = findViewById<FrameLayout>(R.id.player_overlay_container)
        val playerView = findViewById<PlayerView>(R.id.exo_player_view)
        val topHud = findViewById<LinearLayout>(R.id.player_top_hud)
        val titleText = findViewById<TextView>(R.id.player_title_text)
        val errorText = findViewById<TextView>(R.id.player_error_text)
        val aspectButton = findViewById<Button>(R.id.btn_player_aspect)
        val closeButton = findViewById<Button>(R.id.btn_player_close)

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
                return assetLoader.shouldInterceptRequest(request.url)
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

    private fun configureSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, true)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false
        if (videoPlayerManagerInitialized() && videoPlayerManager.isOverlayVisible()) {
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun videoPlayerManagerInitialized(): Boolean = ::videoPlayerManager.isInitialized

    companion object {
        private const val ASSET_ENTRY_URL =
            "https://appassets.androidplatform.net/assets/web/index.html"
        private const val BACK_EXIT_WINDOW_MS = 2000L
    }
}
