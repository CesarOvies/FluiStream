package com.cesarovies.fluistream

import android.view.KeyEvent
import android.webkit.WebView

/**
 * Handles Android TV / Fire TV Stick D-Pad and media remote key events across WebView and PlayerView.
 */
class TvFocusHelper(
    private val webView: WebView,
    private val videoPlayerManager: VideoPlayerManager,
    private val onBackRequested: () -> Boolean
) {

    private var centerKeyDownTime = 0L
    private var centerLongPressFired = false
    private val centerLongPressHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val centerLongPressRunnable = Runnable {
        centerLongPressFired = true
        // Dispatch KEYCODE_MENU to WebView to trigger channel options / favorites
        val now = android.os.SystemClock.uptimeMillis()
        val menuDown = KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MENU, 0)
        val menuUp = KeyEvent(now, now, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MENU, 0)
        webView.dispatchKeyEvent(menuDown)
        webView.dispatchKeyEvent(menuUp)
    }

    fun handleDispatchKeyEvent(event: KeyEvent): KeyEventResult {
        val keyCode = event.keyCode

        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP && !event.isCanceled) {
                return if (onBackRequested()) KeyEventResult.CONSUMED else KeyEventResult.PASS_THROUGH
            }
            return KeyEventResult.CONSUMED
        }

        if (videoPlayerManager.isFullscreen()) {
            return handlePlayerKeyEvent(event)
        }

        return handleWebViewKeyEvent(event)
    }

    private fun handlePlayerKeyEvent(event: KeyEvent): KeyEventResult {
        if (event.action != KeyEvent.ACTION_DOWN) {
            return KeyEventResult.PASS_THROUGH
        }

        return when (event.keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                videoPlayerManager.togglePlayPause()
                KeyEventResult.CONSUMED
            }
            KeyEvent.KEYCODE_MEDIA_STOP -> {
                videoPlayerManager.stop()
                KeyEventResult.CONSUMED
            }
            KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_DPAD_DOWN,
            KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT -> {
                if (!videoPlayerManager.isControllerFullyVisible()) {
                    videoPlayerManager.showController()
                }
                KeyEventResult.PASS_THROUGH
            }
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                if (!videoPlayerManager.isControllerFullyVisible()) {
                    videoPlayerManager.showController()
                    KeyEventResult.CONSUMED
                } else {
                    KeyEventResult.PASS_THROUGH
                }
            }
            else -> KeyEventResult.PASS_THROUGH
        }
    }

    private fun handleWebViewKeyEvent(event: KeyEvent): KeyEventResult {
        if (!webView.hasFocus()) {
            webView.requestFocus()
        }

        // Translate TV remote DPAD_CENTER / NUMPAD_ENTER into KEYCODE_ENTER so Chromium activates focused elements
        // Also tracks long press (segurar no controle remoto) to trigger channel options / favorites
        if (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER || event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                if (event.repeatCount == 0) {
                    centerKeyDownTime = event.downTime
                    centerLongPressFired = false
                    centerLongPressHandler.removeCallbacks(centerLongPressRunnable)
                    centerLongPressHandler.postDelayed(centerLongPressRunnable, 450L)
                } else if (centerLongPressFired) {
                    return KeyEventResult.CONSUMED
                }
            } else if (event.action == KeyEvent.ACTION_UP) {
                centerLongPressHandler.removeCallbacks(centerLongPressRunnable)
                if (centerLongPressFired) {
                    centerLongPressFired = false
                    return KeyEventResult.CONSUMED
                }
            }

            val mappedEvent = KeyEvent(
                event.downTime,
                event.eventTime,
                event.action,
                KeyEvent.KEYCODE_ENTER,
                event.repeatCount,
                event.metaState,
                event.deviceId,
                event.scanCode,
                event.flags,
                event.source
            )
            webView.dispatchKeyEvent(mappedEvent)
            return KeyEventResult.CONSUMED
        }

        // Forward TV remote KEYCODE_MENU to trigger channel options / contextmenu
        if (event.keyCode == KeyEvent.KEYCODE_MENU) {
            val mappedEvent = KeyEvent(
                event.downTime,
                event.eventTime,
                event.action,
                KeyEvent.KEYCODE_MENU,
                event.repeatCount,
                event.metaState,
                event.deviceId,
                event.scanCode,
                event.flags,
                event.source
            )
            webView.dispatchKeyEvent(mappedEvent)
            return KeyEventResult.CONSUMED
        }

        return KeyEventResult.PASS_THROUGH
    }

    enum class KeyEventResult {
        CONSUMED,
        PASS_THROUGH
    }
}
