package com.cesarovies.fluistream

import android.content.Context
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
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
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
    private val onClosed: () -> Unit
) {

    private var exoPlayer: ExoPlayer? = null
    private var currentAspectRatio: String = "auto"
    private var naturalVideoAspectRatio: Float = 0f

    private val aspectCycle = listOf("auto", "16:9", "4:3", "fill")

    init {
        aspectButton.setOnClickListener {
            val nextIdx = (aspectCycle.indexOf(currentAspectRatio) + 1) % aspectCycle.size
            setAspectRatio(aspectCycle[nextIdx])
        }

        closeButton.setOnClickListener {
            stop()
        }

        playerView.setControllerVisibilityListener(
            PlayerView.ControllerVisibilityListener { visibility ->
                topHud.visibility = visibility
            }
        )
    }

    fun isOverlayVisible(): Boolean = overlayContainer.visibility == View.VISIBLE

    fun play(url: String, title: String, itemType: String, streamMode: String) {
        ensurePlayer()

        titleText.text = title.ifBlank { context.getString(R.string.app_name) }
        errorText.visibility = View.GONE
        overlayContainer.visibility = View.VISIBLE
        topHud.visibility = View.VISIBLE
        onOpened()

        val mediaItemBuilder = MediaItem.Builder().setUri(Uri.parse(url))
        detectMimeType(url, itemType, streamMode)?.let { mime ->
            mediaItemBuilder.setMimeType(mime)
        }

        val player = exoPlayer ?: return
        player.stop()
        player.clearMediaItems()
        player.setMediaItem(mediaItemBuilder.build())
        player.prepare()
        player.playWhenReady = true

        applyAspectRatio(currentAspectRatio)
        playerView.showController()
        playerView.requestFocus()
    }

    fun stop() {
        val wasVisible = isOverlayVisible()
        exoPlayer?.let { player ->
            player.playWhenReady = false
            player.stop()
            player.clearMediaItems()
        }
        errorText.visibility = View.GONE
        overlayContainer.visibility = View.GONE
        if (wasVisible) {
            onClosed()
        }
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

        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setUserAgent("FluiStream/${BuildConfig.VERSION_NAME} (Android)")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(15_000)

        val mediaSourceFactory = DefaultMediaSourceFactory(context)
            .setDataSourceFactory(httpDataSourceFactory)

        val player = ExoPlayer.Builder(context)
            .setMediaSourceFactory(mediaSourceFactory)
            .build()

        player.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
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

    private fun detectMimeType(url: String, itemType: String, streamMode: String): String? {
        val path = Uri.parse(url).path?.lowercase().orEmpty()
        return when {
            path.endsWith(".m3u8") || streamMode == "hls" -> MimeTypes.APPLICATION_M3U8
            path.endsWith(".mpd") -> MimeTypes.APPLICATION_MPD
            streamMode == "ts" || path.endsWith(".ts") -> null // Handled natively by DefaultExtractorsFactory (TsExtractor)
            itemType == "live" && streamMode == "auto" && path.contains(".m3u8") -> MimeTypes.APPLICATION_M3U8
            else -> null
        }
    }
}
