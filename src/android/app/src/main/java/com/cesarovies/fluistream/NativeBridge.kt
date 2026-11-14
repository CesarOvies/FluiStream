package com.cesarovies.fluistream

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface

/**
 * JavaScript <-> Kotlin bridge exposed to the WebView as `window.androidBridge`.
 */
class NativeBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun playStream(url: String?, title: String?, itemType: String?, streamMode: String?) {
        val safeUrl = url?.trim().orEmpty()
        if (safeUrl.isEmpty()) return
        val safeTitle = title?.trim().orEmpty()
        val safeType = itemType?.trim().orEmpty().ifEmpty { "live" }
        val safeMode = streamMode?.trim().orEmpty().ifEmpty { "auto" }

        activity.runOnUiThread {
            activity.videoPlayerManager.play(safeUrl, safeTitle, safeType, safeMode)
        }
    }

    @JavascriptInterface
    fun stopStream() {
        activity.runOnUiThread {
            activity.videoPlayerManager.stop()
        }
    }

    @JavascriptInterface
    fun setAspectRatio(ratio: String?) {
        val safeRatio = ratio?.trim().orEmpty().ifEmpty { "auto" }
        activity.runOnUiThread {
            activity.videoPlayerManager.setAspectRatio(safeRatio)
        }
    }

    @JavascriptInterface
    fun isAndroid(): Boolean = true

    @JavascriptInterface
    fun isTv(): Boolean {
        val uiModeManager = activity.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        if (uiModeManager?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return true
        val pm = activity.packageManager
        @Suppress("DEPRECATION")
        return pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
            pm.hasSystemFeature(PackageManager.FEATURE_TELEVISION)
    }

    @JavascriptInterface
    fun showKeyboard() {
        activity.runOnUiThread {
            activity.webView.requestFocus()
            val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            imm?.showSoftInput(activity.webView, InputMethodManager.SHOW_IMPLICIT)
        }
    }

    @JavascriptInterface
    fun hideKeyboard() {
        activity.runOnUiThread {
            val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            imm?.hideSoftInputFromWindow(activity.webView.windowToken, 0)
        }
    }

    @JavascriptInterface
    fun getPlatform(): String = "android"

    @JavascriptInterface
    fun getAppVersion(): String = activity.appUpdateManager.getInstalledVersionName()

    @JavascriptInterface
    fun notifyUpdateAvailable(
        latestVersion: String?,
        title: String?,
        body: String?,
        releaseNotes: String?,
        apkDownloadUrl: String?,
        apkAssetName: String?,
        sha256SumsUrl: String?,
        releaseUrl: String?
    ) {
        val url = apkDownloadUrl?.trim().orEmpty()
        val version = latestVersion?.trim().orEmpty()
        if (url.isEmpty() || version.isEmpty()) return

        val info = AndroidUpdateInfo(
            latestVersion = version,
            title = title?.trim().orEmpty(),
            body = body?.trim().orEmpty(),
            releaseNotes = releaseNotes?.trim().orEmpty(),
            apkDownloadUrl = url,
            apkAssetName = apkAssetName?.trim().orEmpty(),
            sha256SumsUrl = sha256SumsUrl?.trim().orEmpty(),
            releaseUrl = releaseUrl?.trim().orEmpty()
        )
        activity.runOnUiThread {
            activity.appUpdateManager.onUpdateDiscovered(info)
        }
    }

    @JavascriptInterface
    fun requestAppUpdate(
        latestVersion: String?,
        releaseNotes: String?,
        apkDownloadUrl: String?,
        apkAssetName: String?,
        sha256SumsUrl: String?,
        releaseUrl: String?
    ) {
        val url = apkDownloadUrl?.trim().orEmpty()
        val version = latestVersion?.trim().orEmpty()
        if (url.isEmpty() || version.isEmpty()) return

        val info = AndroidUpdateInfo(
            latestVersion = version,
            title = "",
            body = "",
            releaseNotes = releaseNotes?.trim().orEmpty(),
            apkDownloadUrl = url,
            apkAssetName = apkAssetName?.trim().orEmpty(),
            sha256SumsUrl = sha256SumsUrl?.trim().orEmpty(),
            releaseUrl = releaseUrl?.trim().orEmpty()
        )
        activity.runOnUiThread {
            activity.appUpdateManager.requestAppUpdate(info)
        }
    }
}
