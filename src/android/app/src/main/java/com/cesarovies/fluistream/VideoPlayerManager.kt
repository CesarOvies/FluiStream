package com.cesarovies.fluistream

import android.content.Context
import android.graphics.Rect
import android.net.Uri
import android.opengl.GLES20
import android.os.Handler
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.VideoSize
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.DefaultVideoFrameProcessor
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import androidx.media3.effect.Presentation
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.video.CompositingVideoSinkProvider
import androidx.media3.exoplayer.video.MediaCodecVideoRenderer
import androidx.media3.exoplayer.video.VideoRendererEventListener
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
    private val onFullscreenChanged: (Boolean) -> Unit = {},
    private val boostButton: Button? = null,
    private val onImageBoostChanged: (String) -> Unit = {}
) {

    private var exoPlayer: ExoPlayer? = null
    private var currentAspectRatio: String = "auto"
    private var currentImageBoost: String = "off"
    private var forceColorTransfersForHdr: Boolean = false
    private var naturalVideoAspectRatio: Float = 0f
    private val pendingFallbackUrls = ArrayDeque<String>()
    private var hasExplicitFallbackUrls: Boolean = false
    private var currentPlayTitle: String = ""
    private var currentPlayItemType: String = "live"
    private var currentPlayStreamMode: String = "auto"
    private var currentPlayUrl: String = ""
    private var isPlayingStream: Boolean = false
    private var isFullscreenMode: Boolean = false
    private val lastBounds: Rect = Rect(0, 0, 0, 0)
    private var lastLayoutVisible: Boolean = true

    private val aspectCycle = listOf("auto", "16:9", "4:3", "fill")
    private val boostCycle = listOf("off", "hd_plus", "ultra_2k")

    init {
        boostButton?.setOnClickListener {
            val currentIdx = boostCycle.indexOf(currentImageBoost).let { if (it >= 0) it else 0 }
            val nextMode = boostCycle[(currentIdx + 1) % boostCycle.size]
            setImageBoost(nextMode)
            onImageBoostChanged(currentImageBoost)
        }
        updateBoostButtonText(currentImageBoost)

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

    fun isLiveStream(): Boolean = isPlayingStream && currentPlayItemType.equals("live", ignoreCase = true)

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

        val preserveFullscreen = isFullscreenMode && isPlayingStream && itemType.equals("live", ignoreCase = true)
        currentPlayTitle = title
        currentPlayItemType = itemType
        currentPlayStreamMode = streamMode
        isPlayingStream = true
        if (!preserveFullscreen) {
            isFullscreenMode = false
        }

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
        if (preserveFullscreen) {
            playerView.showController()
        }
        onOpened()

        startPlaybackUrl(url)

        applyAspectRatio(currentAspectRatio)
    }

    fun setImageBoost(mode: String) {
        val normalized = when (mode.trim().lowercase()) {
            "hd_plus" -> "hd_plus"
            "ultra_2k" -> "ultra_2k"
            else -> "off"
        }
        val modeChanged = normalized != currentImageBoost
        currentImageBoost = normalized
        if (modeChanged) {
            forceColorTransfersForHdr = false
        }
        updateBoostButtonText(normalized)

        val player = exoPlayer ?: return
        if (!modeChanged) return

        if (isPlayingStream && currentPlayUrl.isNotEmpty()) {
            restartPlaybackWithCurrentBoost(player, currentPlayUrl)
        } else {
            // Drop idle player so the next play() initializes VideoSink cleanly for the new mode.
            release()
        }
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
        currentPlayUrl = ""
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

        val renderersFactory = object : DefaultRenderersFactory(context) {
            override fun buildVideoRenderers(
                context: Context,
                extensionRendererMode: Int,
                mediaCodecSelector: MediaCodecSelector,
                enableDecoderFallback: Boolean,
                eventHandler: Handler,
                eventListener: VideoRendererEventListener,
                allowedVideoJoiningTimeMs: Long,
                out: ArrayList<Renderer>
            ) {
                val frameProcessorFactory = DefaultVideoFrameProcessor.Factory.Builder()
                    .setEnableColorTransfers(forceColorTransfersForHdr)
                    .build()
                val videoSinkProvider = CompositingVideoSinkProvider.Builder(context)
                    .setVideoFrameProcessorFactory(frameProcessorFactory)
                    .build()
                out.add(
                    MediaCodecVideoRenderer(
                        context,
                        getCodecAdapterFactory(),
                        mediaCodecSelector,
                        allowedVideoJoiningTimeMs,
                        enableDecoderFallback,
                        eventHandler,
                        eventListener,
                        MAX_DROPPED_VIDEO_FRAME_COUNT_TO_NOTIFY,
                        30f,
                        videoSinkProvider
                    )
                )
            }
        }.setEnableDecoderFallback(true)

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
                if (currentImageBoost != "off" &&
                    !forceColorTransfersForHdr &&
                    error.errorCode == PlaybackException.ERROR_CODE_VIDEO_FRAME_PROCESSOR_INIT_FAILED
                ) {
                    android.util.Log.w(
                        "VideoPlayerManager",
                        "Video frame processor init failed with gamma path; retrying with enableColorTransfers=true",
                        error
                    )
                    forceColorTransfersForHdr = true
                    errorText.visibility = View.GONE
                    val retryUrl = currentPlayUrl
                    if (isPlayingStream && retryUrl.isNotEmpty()) {
                        playerView.post {
                            if (isPlayingStream && currentPlayUrl == retryUrl && exoPlayer === player) {
                                restartPlaybackWithCurrentBoost(player, retryUrl)
                            }
                        }
                        return
                    }
                }
                if (currentImageBoost != "off" &&
                    (error.errorCode == PlaybackException.ERROR_CODE_VIDEO_FRAME_PROCESSOR_INIT_FAILED ||
                        error.errorCode == PlaybackException.ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED)
                ) {
                    android.util.Log.w(
                        "VideoPlayerManager",
                        "Video frame processor error (${error.errorCode}); falling back to boost=off",
                        error
                    )
                    forceColorTransfersForHdr = false
                    currentImageBoost = "off"
                    applyImageBoostEffects(player, "off")
                    updateBoostButtonText("off")
                    onImageBoostChanged("off")
                    errorText.visibility = View.GONE
                    val fallbackUrl = currentPlayUrl
                    if (isPlayingStream && fallbackUrl.isNotEmpty()) {
                        playerView.post {
                            if (isPlayingStream && currentPlayUrl == fallbackUrl && exoPlayer === player) {
                                restartPlaybackWithCurrentBoost(player, fallbackUrl)
                            }
                        }
                        return
                    }
                }
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

        if (currentImageBoost != "off") {
            applyImageBoostEffects(player, currentImageBoost)
        }

        exoPlayer = player
        playerView.player = player
    }

    private fun updateBoostButtonText(mode: String) {
        boostButton?.text = when (mode) {
            "hd_plus" -> context.getString(R.string.player_boost_hd_plus)
            "ultra_2k" -> context.getString(R.string.player_boost_ultra_2k)
            else -> context.getString(R.string.player_boost_off)
        }
    }

    private fun applyImageBoostEffects(player: ExoPlayer, mode: String) {
        val effects: List<Effect> = when (mode) {
            "hd_plus" -> listOf(
                CasSharpenGlEffect(sharpness = 0.55f, detailGain = 0.32f, deblock = 0.20f),
                Presentation.createForHeight(1080)
            )
            "ultra_2k" -> listOf(
                CasSharpenGlEffect(sharpness = 0.88f, detailGain = 0.54f, deblock = 0.30f),
                Presentation.createForHeight(1440)
            )
            else -> emptyList()
        }
        runCatching {
            player.setVideoEffects(effects)
        }.onFailure { err ->
            android.util.Log.w("VideoPlayerManager", "Failed to apply video effects ($mode)", err)
        }
    }

    private fun restartPlaybackWithCurrentBoost(player: ExoPlayer, url: String) {
        val hadBoostFocus = boostButton?.hasFocus() == true
        val shouldPlay = player.playWhenReady
        val resumePos = if (!player.isCurrentMediaItemLive && player.isCurrentMediaItemSeekable) {
            player.currentPosition.coerceAtLeast(0L)
        } else {
            0L
        }
        errorText.visibility = View.GONE
        // Recreate ExoPlayer so MediaCodecVideoRenderer cleanly binds or detaches VideoSink before prepare().
        release()
        ensurePlayer()
        startPlaybackUrl(url, resumePositionMs = resumePos, autoPlay = shouldPlay)
        applyAspectRatio(currentAspectRatio)
        if (isFullscreenMode) {
            playerView.showController()
            if (hadBoostFocus) {
                boostButton?.requestFocus()
            }
        }
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

    private fun startPlaybackUrl(
        url: String,
        resumePositionMs: Long = 0L,
        autoPlay: Boolean = true
    ) {
        currentPlayUrl = url
        val player = exoPlayer ?: return
        val mediaItemBuilder = MediaItem.Builder().setUri(Uri.parse(url))
        detectMimeType(url, currentPlayItemType, currentPlayStreamMode)?.let { mime ->
            mediaItemBuilder.setMimeType(mime)
        }

        player.stop()
        player.clearMediaItems()
        player.setMediaItem(mediaItemBuilder.build())
        if (resumePositionMs > 0L) {
            player.seekTo(resumePositionMs)
        }
        player.prepare()
        player.playWhenReady = autoPlay
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

@OptIn(UnstableApi::class)
private data class CasSharpenGlEffect(
    private val sharpness: Float,
    private val detailGain: Float,
    private val deblock: Float
) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram {
        return CasSharpenShaderProgram(useHdr, sharpness, detailGain, deblock)
    }

    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean {
        return sharpness <= 0f && detailGain <= 0f && deblock <= 0f
    }
}

@OptIn(UnstableApi::class)
private class CasSharpenShaderProgram(
    useHdr: Boolean,
    sharpness: Float,
    detailGain: Float,
    deblock: Float
) : BaseGlShaderProgram(useHdr, 1) {

    private val glProgram: GlProgram = try {
        GlProgram(VERTEX_SHADER, FRAGMENT_SHADER).apply {
            setBufferAttribute(
                "aFramePosition",
                GlUtil.getNormalizedCoordinateBounds(),
                GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE
            )
            setFloatsUniform("uTexelSize", floatArrayOf(1f / 1920f, 1f / 1080f))
            setFloatUniform("uSharpness", sharpness)
            setFloatUniform("uDetailGain", detailGain)
            setFloatUniform("uDeblock", deblock)
        }
    } catch (e: GlUtil.GlException) {
        throw VideoFrameProcessingException(e)
    }

    override fun configure(inputWidth: Int, inputHeight: Int): Size {
        val safeW = inputWidth.coerceAtLeast(1)
        val safeH = inputHeight.coerceAtLeast(1)
        glProgram.setFloatsUniform("uTexelSize", floatArrayOf(1f / safeW.toFloat(), 1f / safeH.toFloat()))
        return Size(inputWidth, inputHeight)
    }

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        try {
            glProgram.use()
            glProgram.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
            glProgram.bindAttributesAndUniforms()
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e, presentationTimeUs)
        }
    }

    override fun release() {
        super.release()
        try {
            glProgram.delete()
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e)
        }
    }

    companion object {
        private const val VERTEX_SHADER = """
#version 100
attribute vec4 aFramePosition;
varying vec2 vTexSamplingCoord;
void main() {
  gl_Position = aFramePosition;
  vTexSamplingCoord = aFramePosition.xy * 0.5 + 0.5;
}
"""

        private const val FRAGMENT_SHADER = """
#version 100
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uTexSampler;
uniform vec2 uTexelSize;
uniform float uSharpness;
uniform float uDetailGain;
uniform float uDeblock;
varying vec2 vTexSamplingCoord;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 uv = vTexSamplingCoord;
  vec2 dx = vec2(uTexelSize.x, 0.0);
  vec2 dy = vec2(0.0, uTexelSize.y);

  vec3 a = texture2D(uTexSampler, uv - dx - dy).rgb;
  vec3 b = texture2D(uTexSampler, uv - dy).rgb;
  vec3 c = texture2D(uTexSampler, uv + dx - dy).rgb;
  vec3 d = texture2D(uTexSampler, uv - dx).rgb;
  vec4 centerTex = texture2D(uTexSampler, uv);
  vec3 e = centerTex.rgb;
  vec3 f = texture2D(uTexSampler, uv + dx).rgb;
  vec3 g = texture2D(uTexSampler, uv - dx + dy).rgb;
  vec3 h = texture2D(uTexSampler, uv + dy).rgb;
  vec3 i = texture2D(uTexSampler, uv + dx + dy).rgb;

  float le = luma(e);
  float la = luma(a);
  float lb = luma(b);
  float lc = luma(c);
  float ld = luma(d);
  float lf = luma(f);
  float lg = luma(g);
  float lh = luma(h);
  float li = luma(i);

  // Edge-preserving bilateral deblock for compressed IPTV feeds
  float wb = exp(-abs(lb - le) * 20.0);
  float wd = exp(-abs(ld - le) * 20.0);
  float wf = exp(-abs(lf - le) * 20.0);
  float wh = exp(-abs(lh - le) * 20.0);
  float wSum = 1.0 + wb + wd + wf + wh;
  vec3 smoothBase = (e + b * wb + d * wd + f * wf + h * wh) / wSum;
  vec3 base = mix(e, smoothBase, clamp(uDeblock * 0.55, 0.0, 0.5));
  float lBase = luma(base);

  // Luminance-preserving AMD FidelityFX CAS 9-tap (zero black crush or chroma shift)
  float minL = min(min(ld, lf), min(lb, lh));
  minL = min(minL, lBase);
  float minL2 = min(minL, min(min(la, lc), min(lg, li)));
  minL = (minL + minL2) * 0.5;

  float maxL = max(max(ld, lf), max(lb, lh));
  maxL = max(maxL, lBase);
  float maxL2 = max(maxL, max(max(la, lc), max(lg, li)));
  maxL = (maxL + maxL2) * 0.5;

  float ampL = clamp(min(minL, max(2.0 - maxL, 0.0)) / max(maxL, 0.0001), 0.0, 1.0);
  ampL = sqrt(ampL);

  float peak = -1.0 / mix(8.5, 5.2, clamp(uSharpness, 0.0, 1.0));
  float wL = max(ampL * peak, -0.19);
  float casLuma = (lb * wL + ld * wL + lf * wL + lh * wL + lBase) / (1.0 + 4.0 * wL);

  // Anti-ringing unsharp detail gated in dark shadows
  float blurL = (lb + ld + lf + lh) * 0.25;
  float detailL = (lBase - blurL) * (uDetailGain * 0.65);
  float shadowGuard = smoothstep(0.015, 0.075, le);
  float targetLuma = clamp(lBase + ((casLuma - lBase) + detailL) * shadowGuard, minL, maxL);
  float deltaL = targetLuma - lBase;

  vec3 minRGB = min(min(d, f), min(b, h));
  minRGB = min(minRGB, base);
  vec3 maxRGB = max(max(d, f), max(b, h));
  maxRGB = max(maxRGB, base);
  vec3 color = clamp(base + vec3(deltaL), minRGB, maxRGB);

  gl_FragColor = vec4(color, centerTex.a);
}
"""
    }
}
