package com.cesarovies.fluistream

import android.content.Context
import android.graphics.Rect
import android.net.Uri
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView

/**
 * Manages native AndroidX Media3 (ExoPlayer) playback for HLS, DASH, and MPEG-TS/progressive IPTV streams.
 */
@OptIn(UnstableApi::class)
class VideoPlayerManager(
    private val context: Context,
    private val overlayContainer: FrameLayout,
    private val playerView: PlayerView,
    private val topHud: LinearLayout,
    private val titleText: TextView,
    private val errorText: TextView,
    private val aspectButton: Button,
    private val closeButton: Button,
    private val onOpened: () -> Unit = {},
    private val onClosed: () -> Unit,
    private val onFullscreenChanged: (Boolean) -> Unit = {}
) {

    private var exoPlayer: ExoPlayer? = null
    private var currentAspectRatio: String = "auto"
    private var naturalVideoAspectRatio: Float = 0f
    private val pendingFallbackUrls = ArrayDeque<String>()
    private var hasExplicitFallbackUrls: Boolean = false
    private var currentPlayTitle: String = ""
    private var currentPlayItemType: String = "live"
    private var currentPlayStreamMode: String = "auto"
    private var isPlayingStream: Boolean = false
    private var isFullscreenMode: Boolean = false
    private val lastBounds: Rect = Rect(0, 0, 0, 0)
    private var lastLayoutVisible: Boolean = true

    private val aspectCycle = listOf("auto", "16:9", "4:3", "fill")

    init {
        aspectButton.setOnClickListener {
            val nextIdx = (aspectCycle.indexOf(currentAspectRatio) + 1) % aspectCycle.size
            setAspectRatio(aspectCycle[nextIdx])
        }

        closeButton.setOnClickListener {
            if (isFullscreenMode) {
                setFullscreen(false)
            } else {
                stop()
            }
        }

        playerView.setFullscreenButtonClickListener {
            if (isFullscreenMode) {
                setFullscreen(false)
            } else {
                setFullscreen(true)
            }
        }

        playerView.setControllerVisibilityListener(
            PlayerView.ControllerVisibilityListener { visibility ->
                topHud.visibility = if (isFullscreenMode) visibility else View.GONE
            }
        )
        updateInteractionMode()
    }

    fun isOverlayVisible(): Boolean = overlayContainer.visibility == View.VISIBLE

    fun isFullscreen(): Boolean = isFullscreenMode && isPlayingStream

    fun setPendingFallbackUrls(urls: List<String>) {
        pendingFallbackUrls.clear()
        urls.asSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
            .forEach { pendingFallbackUrls.addLast(it) }
        hasExplicitFallbackUrls = true
    }

    fun play(url: String, title: String, itemType: String, streamMode: String) {
        ensurePlayer()

        currentPlayTitle = title
        currentPlayItemType = itemType
        currentPlayStreamMode = streamMode
        isPlayingStream = true
        isFullscreenMode = false

        if (!hasExplicitFallbackUrls) {
            pendingFallbackUrls.clear()
        }
        hasExplicitFallbackUrls = false

        val normalizedCandidates = pendingFallbackUrls
            .filter { it != url }
            .distinct()
        pendingFallbackUrls.clear()
        normalizedCandidates.forEach { pendingFallbackUrls.addLast(it) }

        if (pendingFallbackUrls.isEmpty()) {
            buildDefaultFallbackUrls(url, itemType, streamMode)
                .filter { it.isNotEmpty() && it != url }
                .distinct()
                .forEach { pendingFallbackUrls.addLast(it) }
        }

        titleText.text = title.ifBlank { context.getString(R.string.app_name) }
        errorText.visibility = View.GONE
        updateInteractionMode()
        applyOverlayLayout()
        onOpened()

        startPlaybackUrl(url)

        applyAspectRatio(currentAspectRatio)
    }

    fun updateLayout(x: Int, y: Int, width: Int, height: Int, visible: Boolean) {
        lastLayoutVisible = visible
        if (!isFullscreenMode && width > 0 && height > 0) {
            lastBounds.set(x, y, x + width, y + height)
        }
        applyOverlayLayout()
    }

    fun setFullscreen(fullscreen: Boolean) {
        if (!isPlayingStream && fullscreen) return
        if (isFullscreenMode == fullscreen) {
            applyOverlayLayout()
            return
        }
        isFullscreenMode = fullscreen
        updateInteractionMode()
        applyOverlayLayout()
        applyAspectRatio(currentAspectRatio)
        if (isFullscreenMode) {
            topHud.visibility = View.VISIBLE
            playerView.showController()
            playerView.requestFocus()
        } else {
            playerView.hideController()
            topHud.visibility = View.GONE
        }
        onFullscreenChanged(isFullscreenMode)
    }

    fun toggleFullscreen() {
        setFullscreen(!isFullscreenMode)
    }

    fun stop() {
        val wasActive = isPlayingStream || isOverlayVisible()
        val wasFullscreen = isFullscreenMode
        isPlayingStream = false
        isFullscreenMode = false
        pendingFallbackUrls.clear()
        hasExplicitFallbackUrls = false
        exoPlayer?.let { player ->
            player.playWhenReady = false
            player.stop()
            player.clearMediaItems()
        }
        errorText.visibility = View.GONE
        updateInteractionMode()
        overlayContainer.visibility = View.GONE
        if (wasFullscreen) {
            onFullscreenChanged(false)
        }
        if (wasActive) {
            onClosed()
        }
    }

    private fun updateInteractionMode() {
        if (isFullscreenMode) {
            playerView.useController = true
            playerView.isClickable = false
            playerView.setOnClickListener(null)
            overlayContainer.isClickable = false
            overlayContainer.setOnClickListener(null)
            overlayContainer.isFocusable = false
            playerView.isFocusable = true
            topHud.visibility = View.VISIBLE
        } else {
            playerView.useController = false
            playerView.hideController()
            topHud.visibility = View.GONE
            overlayContainer.isFocusable = false
            playerView.isFocusable = false
            val enterFullscreenOnTap = View.OnClickListener {
                if (!isFullscreenMode && isPlayingStream) {
                    setFullscreen(true)
                }
            }
            playerView.isClickable = true
            playerView.setOnClickListener(enterFullscreenOnTap)
            overlayContainer.isClickable = true
            overlayContainer.setOnClickListener(enterFullscreenOnTap)
        }
    }

    private fun applyOverlayLayout() {
        if (!isPlayingStream) {
            if (overlayContainer.visibility != View.GONE) {
                overlayContainer.visibility = View.GONE
            }
            return
        }

        if (isFullscreenMode) {
            val lp = (overlayContainer.layoutParams as? FrameLayout.LayoutParams)
                ?: FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            if (lp.width != FrameLayout.LayoutParams.MATCH_PARENT ||
                lp.height != FrameLayout.LayoutParams.MATCH_PARENT ||
                lp.leftMargin != 0 ||
                lp.topMargin != 0
            ) {
                lp.width = FrameLayout.LayoutParams.MATCH_PARENT
                lp.height = FrameLayout.LayoutParams.MATCH_PARENT
                lp.setMargins(0, 0, 0, 0)
                overlayContainer.layoutParams = lp
            }
            if (overlayContainer.visibility != View.VISIBLE) {
                overlayContainer.visibility = View.VISIBLE
            }
            overlayContainer.requestLayout()
            playerView.requestLayout()
            return
        }

        val w = lastBounds.width()
        val h = lastBounds.height()
        if (!lastLayoutVisible || w <= 0 || h <= 0) {
            if (overlayContainer.visibility != View.GONE) {
                overlayContainer.visibility = View.GONE
            }
            return
        }

        val lp = (overlayContainer.layoutParams as? FrameLayout.LayoutParams)
            ?: FrameLayout.LayoutParams(w, h)
        if (lp.width != w || lp.height != h || lp.leftMargin != lastBounds.left || lp.topMargin != lastBounds.top) {
            lp.width = w
            lp.height = h
            lp.setMargins(lastBounds.left, lastBounds.top, 0, 0)
            overlayContainer.layoutParams = lp
        }
        if (overlayContainer.visibility != View.VISIBLE) {
            overlayContainer.visibility = View.VISIBLE
        }
        overlayContainer.requestLayout()
        playerView.requestLayout()
    }

    fun togglePlayPause() {
        val player = exoPlayer ?: return
        if (player.isPlaying) {
            player.pause()
        } else {
            player.play()
        }
        playerView.showController()
    }

    fun setAspectRatio(ratio: String) {
        currentAspectRatio = ratio
        applyAspectRatio(ratio)
        aspectButton.text = when (ratio) {
            "16:9" -> context.getString(R.string.player_aspect_16_9)
            "4:3" -> context.getString(R.string.player_aspect_4_3)
            "fill" -> context.getString(R.string.player_aspect_fill)
            else -> context.getString(R.string.player_aspect_auto)
        }
    }

    fun showController() {
        playerView.showController()
    }

    fun isControllerFullyVisible(): Boolean = playerView.isControllerFullyVisible

    fun onPause() {
        exoPlayer?.pause()
    }

    fun release() {
        playerView.player = null
        exoPlayer?.release()
        exoPlayer = null
    }

    private fun ensurePlayer() {
        if (exoPlayer != null) return

        val appVersion = BuildConfig.VERSION_NAME
        val iptvUserAgent = "IPTVSmartersPro/3.1.5 (Linux;Android 11) VLC/3.0.20"
        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setUserAgent(iptvUserAgent)
            .setDefaultRequestProperties(
                mapOf(
                    "User-Agent" to iptvUserAgent,
                    "Accept" to "*/*"
                )
            )
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(25_000)
            .setReadTimeoutMs(25_000)

        val extractorsFactory = DefaultExtractorsFactory()
            .setTsExtractorFlags(
                DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or
                    DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS
            )

        val mediaSourceFactory = DefaultMediaSourceFactory(context, extractorsFactory)
            .setDataSourceFactory(httpDataSourceFactory)

        val renderersFactory = DefaultRenderersFactory(context)
            .setEnableDecoderFallback(true)

        val player = ExoPlayer.Builder(context)
            .setRenderersFactory(renderersFactory)
            .setMediaSourceFactory(mediaSourceFactory)
            .build()

        player.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                android.util.Log.e(
                    "VideoPlayerManager",
                    "PlaybackException (code=${error.errorCode}): ${error.message}",
                    error
                )
                if (pendingFallbackUrls.isNotEmpty()) {
                    val nextUrl = pendingFallbackUrls.removeFirst()
                    errorText.visibility = View.GONE
                    startPlaybackUrl(nextUrl)
                    return
                }
                errorText.text = when (error.errorCode) {
                    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
                    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
                    PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> {
                        context.getString(R.string.player_error_network)
                    }
                    else -> context.getString(R.string.player_error_playback)
                }
                errorText.visibility = View.VISIBLE
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) {
                    errorText.visibility = View.GONE
                }
            }

            override fun onVideoSizeChanged(videoSize: VideoSize) {
                if (videoSize.width > 0 && videoSize.height > 0) {
                    naturalVideoAspectRatio =
                        (videoSize.width * videoSize.pixelWidthHeightRatio) / videoSize.height.toFloat()
                    if (currentAspectRatio == "auto") {
                        applyAspectRatio("auto")
                    }
                }
            }
        })

        exoPlayer = player
        playerView.player = player
    }

    private fun applyAspectRatio(ratio: String) {
        val contentFrame = playerView.findViewById<AspectRatioFrameLayout>(
            androidx.media3.ui.R.id.exo_content_frame
        )

        when (ratio) {
            "fill" -> {
                playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL
            }
            "16:9" -> {
                playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                contentFrame?.setAspectRatio(16f / 9f)
            }
            "4:3" -> {
                playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                contentFrame?.setAspectRatio(4f / 3f)
            }
            else -> {
                playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                if (naturalVideoAspectRatio > 0f) {
                    contentFrame?.setAspectRatio(naturalVideoAspectRatio)
                }
            }
        }
    }

    private fun startPlaybackUrl(url: String) {
        val player = exoPlayer ?: return
        val mediaItemBuilder = MediaItem.Builder().setUri(Uri.parse(url))
        detectMimeType(url, currentPlayItemType, currentPlayStreamMode)?.let { mime ->
            mediaItemBuilder.setMimeType(mime)
        }

        player.stop()
        player.clearMediaItems()
        player.setMediaItem(mediaItemBuilder.build())
        player.prepare()
        player.playWhenReady = true
    }

    private fun buildDefaultFallbackUrls(url: String, itemType: String, streamMode: String): List<String> {
        if (streamMode == "direct") return emptyList()
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return emptyList()
        val path = uri.path.orEmpty()
        val lowerPath = path.lowercase()
        if (lowerPath.endsWith(".mp4") || lowerPath.endsWith(".mkv") || lowerPath.endsWith(".avi") || lowerPath.endsWith(".webm")) {
            return emptyList()
        }

        val fallbacks = mutableListOf<String>()
        if (itemType == "live" && lowerPath.endsWith(".m3u8")) {
            val tsPath = path.dropLast(5) + ".ts"
            fallbacks.add(uri.buildUpon().path(tsPath).build().toString())
        } else if (lowerPath.endsWith(".ts")) {
            val hlsPath = path.dropLast(3) + ".m3u8"
            fallbacks.add(uri.buildUpon().path(hlsPath).build().toString())
        }
        return fallbacks
    }

    private fun detectMimeType(url: String, itemType: String, streamMode: String): String? {
        val path = Uri.parse(url).path?.lowercase().orEmpty()
        return when {
            path.endsWith(".m3u8") || path.contains(".m3u8") -> MimeTypes.APPLICATION_M3U8
            path.endsWith(".mpd") -> MimeTypes.APPLICATION_MPD
            path.endsWith(".ts") || streamMode == "ts" -> null // Handled natively by DefaultExtractorsFactory (TsExtractor)
            streamMode == "hls" -> MimeTypes.APPLICATION_M3U8
            itemType == "live" && streamMode == "auto" -> MimeTypes.APPLICATION_M3U8
            else -> null
        }
    }
}
