package com.cesarovies.fluistream

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
    fun getPlatform(): String = "android"
}
