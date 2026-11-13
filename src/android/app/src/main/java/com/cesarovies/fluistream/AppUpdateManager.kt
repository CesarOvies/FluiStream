package com.cesarovies.fluistream

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.text.method.ScrollingMovementMethod
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

data class AndroidUpdateInfo(
    val latestVersion: String,
    val title: String,
    val body: String,
    val releaseNotes: String,
    val apkDownloadUrl: String,
    val apkAssetName: String,
    val sha256SumsUrl: String,
    val releaseUrl: String
)

/**
 * Gerencia notificações, autorização do usuário, download, validação SHA-256
 * e disparo do instalador de APK no Android / Android TV.
 */
class AppUpdateManager(
    private val activity: MainActivity,
    private val requestInstallPermission: (Intent) -> Unit,
    private val requestNotificationPermission: (String) -> Unit
) {
    private val executor = Executors.newSingleThreadExecutor()
    private var pendingUpdate: AndroidUpdateInfo? = null
    private var updateAwaitingInstallPermission: AndroidUpdateInfo? = null
    private var activeDialog: AlertDialog? = null
    private var activeDownloadCancel: AtomicBoolean? = null
    private var hasRequestedNotificationPermission = false
    private var lastNotifiedVersion: String? = null

    fun getInstalledVersionName(): String {
        return try {
            val pkgInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activity.packageManager.getPackageInfo(
                    activity.packageName,
                    PackageManager.PackageInfoFlags.of(0)
                )
            } else {
                @Suppress("DEPRECATION")
                activity.packageManager.getPackageInfo(activity.packageName, 0)
            }
            pkgInfo.versionName?.trim().orEmpty().ifEmpty { FALLBACK_VERSION }
        } catch (_: Exception) {
            FALLBACK_VERSION
        }
    }

    fun onUpdateDiscovered(info: AndroidUpdateInfo) {
        if (!isTrustedReleaseUrl(info.apkDownloadUrl)) return
        pendingUpdate = info

        if (lastNotifiedVersion == info.latestVersion) return

        if (canPostNotifications()) {
            postUpdateNotification(info)
        } else if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !hasRequestedNotificationPermission &&
            !isTvDevice()
        ) {
            hasRequestedNotificationPermission = true
            requestNotificationPermission(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    fun postPendingNotificationIfAny() {
        val info = pendingUpdate ?: return
        if (canPostNotifications()) {
            postUpdateNotification(info)
        }
    }

    fun handleNotificationPromptIntent() {
        val existing = pendingUpdate
        if (existing != null) {
            showAuthorizationDialog(existing, startDownloadImmediately = false)
            return
        }

        // Fallback caso o processo tenha sido recriado pelo sistema ao tocar na notificação
        executor.execute {
            val fetched = fetchLatestReleaseBlocking()
            activity.runOnUiThread {
                if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                if (fetched != null) {
                    pendingUpdate = fetched
                    showAuthorizationDialog(fetched, startDownloadImmediately = false)
                }
            }
        }
    }

    fun requestAppUpdate(info: AndroidUpdateInfo) {
        if (!isTrustedReleaseUrl(info.apkDownloadUrl)) {
            openExternalRelease(info.releaseUrl)
            return
        }
        pendingUpdate = info
        showAuthorizationDialog(info, startDownloadImmediately = true)
    }

    fun onInstallPermissionResult() {
        val info = updateAwaitingInstallPermission ?: return
        updateAwaitingInstallPermission = null
        if (canInstallPackages()) {
            showAuthorizationDialog(info, startDownloadImmediately = true)
        }
    }

    fun release() {
        activeDownloadCancel?.set(true)
        activeDialog?.dismiss()
        activeDialog = null
        executor.shutdownNow()
    }

    private fun canPostNotifications(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return false
        }
        return NotificationManagerCompat.from(activity).areNotificationsEnabled()
    }

    private fun isTvDevice(): Boolean {
        return activity.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
    }

    private fun canInstallPackages(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.packageManager.canRequestPackageInstalls()
        } else {
            true
        }
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                ?: return
            if (manager.getNotificationChannel(CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    activity.getString(R.string.update_channel_name),
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = activity.getString(R.string.update_channel_desc)
                }
                manager.createNotificationChannel(channel)
            }
        }
    }

    private fun postUpdateNotification(info: AndroidUpdateInfo) {
        ensureNotificationChannel()

        val tapIntent = Intent(activity, MainActivity::class.java).apply {
            action = ACTION_PROMPT_UPDATE
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            activity,
            UPDATE_NOTIFICATION_ID,
            tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = info.title.ifBlank { activity.getString(R.string.update_available_title) }
        val body = info.body.ifBlank {
            activity.getString(
                R.string.update_available_header,
                getInstalledVersionName(),
                info.latestVersion
            )
        }

        val notification = NotificationCompat.Builder(activity, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_update)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        try {
            NotificationManagerCompat.from(activity).notify(UPDATE_NOTIFICATION_ID, notification)
            lastNotifiedVersion = info.latestVersion
        } catch (_: SecurityException) {
            // Permissão revogada entre a checagem e o notify
        }
    }

    private fun showAuthorizationDialog(info: AndroidUpdateInfo, startDownloadImmediately: Boolean) {
        if (activity.isFinishing || activity.isDestroyed) return

        if (!canInstallPackages()) {
            showInstallPermissionDialog(info)
            return
        }

        activeDialog?.dismiss()

        val dp = { value: Int ->
            TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value.toFloat(),
                activity.resources.displayMetrics
            ).toInt()
        }

        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#0F172A"))
                cornerRadius = dp(12).toFloat()
                setStroke(dp(1), Color.parseColor("#1E293B"))
            }
        }

        val titleView = TextView(activity).apply {
            text = activity.getString(R.string.update_available_title)
            setTextColor(Color.parseColor("#10B981"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
        }
        root.addView(titleView)

        val headerView = TextView(activity).apply {
            text = activity.getString(
                R.string.update_available_header,
                getInstalledVersionName(),
                info.latestVersion
            )
            setTextColor(Color.parseColor("#F0F6FC"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, dp(6), 0, dp(12))
        }
        root.addView(headerView)

        val notesView = TextView(activity).apply {
            text = info.releaseNotes.ifBlank {
                activity.getString(R.string.update_release_notes_fallback)
            }
            setTextColor(Color.parseColor("#94A3B8"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            maxHeight = dp(140)
            movementMethod = ScrollingMovementMethod()
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#06101E"))
                cornerRadius = dp(8).toFloat()
                setStroke(dp(1), Color.parseColor("#1E293B"))
            }
        }
        root.addView(notesView)

        val statusView = TextView(activity).apply {
            text = activity.getString(R.string.update_prompt_message)
            setTextColor(Color.parseColor("#F0F6FC"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, dp(8))
        }
        root.addView(statusView)

        val progressBar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = 0
            visibility = View.GONE
            progressTintList = ColorStateList.valueOf(Color.parseColor("#38BDF8"))
            indeterminateTintList = ColorStateList.valueOf(Color.parseColor("#F59E0B"))
            progressBackgroundTintList = ColorStateList.valueOf(Color.parseColor("#1E293B"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(8)
            ).apply {
                topMargin = dp(4)
                bottomMargin = dp(14)
            }
        }
        root.addView(progressBar)

        val btnRow = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
        }

        val btnSecondary = createDialogButton(
            label = activity.getString(R.string.update_btn_later),
            bgColor = "#1E293B",
            borderColor = "#1E293B",
            textColor = "#F0F6FC",
            dp = dp
        )
        val btnPrimary = createDialogButton(
            label = activity.getString(R.string.update_btn_now),
            bgColor = "#10B981",
            borderColor = "#10B981",
            textColor = "#06101E",
            dp = dp
        )

        val rowSpacing = LinearLayout.LayoutParams(
            0,
            dp(42),
            1f
        )
        val leftParams = LinearLayout.LayoutParams(rowSpacing).apply { marginEnd = dp(8) }
        val rightParams = LinearLayout.LayoutParams(rowSpacing).apply { marginStart = dp(8) }

        btnRow.addView(btnSecondary, leftParams)
        btnRow.addView(btnPrimary, rightParams)
        root.addView(btnRow)

        val dialog = AlertDialog.Builder(activity)
            .setView(root)
            .setCancelable(true)
            .create()

        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))

        val cancelFlag = AtomicBoolean(false)
        activeDownloadCancel = cancelFlag

        dialog.setOnDismissListener {
            cancelFlag.set(true)
            if (activeDialog === dialog) {
                activeDialog = null
            }
        }

        btnSecondary.setOnClickListener {
            cancelFlag.set(true)
            dialog.dismiss()
        }

        val beginUpdate = {
            btnPrimary.isEnabled = false
            btnPrimary.alpha = 0.5f
            btnSecondary.text = activity.getString(R.string.update_btn_cancel)
            dialog.setCancelable(false)
            progressBar.visibility = View.VISIBLE
            progressBar.isIndeterminate = false
            progressBar.progress = 0
            statusView.setTextColor(Color.parseColor("#F0F6FC"))
            statusView.text = activity.getString(R.string.update_downloading, 0)

            startDownloadAndInstall(
                info = info,
                cancelFlag = cancelFlag,
                onProgress = { pct ->
                    activity.runOnUiThread {
                        if (!dialog.isShowing) return@runOnUiThread
                        progressBar.isIndeterminate = false
                        progressBar.progress = pct
                        statusView.text = activity.getString(R.string.update_downloading, pct)
                    }
                },
                onVerifying = {
                    activity.runOnUiThread {
                        if (!dialog.isShowing) return@runOnUiThread
                        progressBar.isIndeterminate = true
                        statusView.setTextColor(Color.parseColor("#38BDF8"))
                        statusView.text = activity.getString(R.string.update_verifying_hash)
                    }
                },
                onLaunchingInstaller = { apkFile ->
                    activity.runOnUiThread {
                        if (dialog.isShowing) {
                            statusView.setTextColor(Color.parseColor("#10B981"))
                            statusView.text = activity.getString(R.string.update_launching_installer)
                            dialog.dismiss()
                        }
                        launchApkInstaller(apkFile)
                    }
                },
                onError = { message ->
                    activity.runOnUiThread {
                        if (!dialog.isShowing) return@runOnUiThread
                        progressBar.visibility = View.GONE
                        progressBar.isIndeterminate = false
                        btnPrimary.isEnabled = true
                        btnPrimary.alpha = 1f
                        btnSecondary.text = activity.getString(R.string.update_btn_later)
                        dialog.setCancelable(true)
                        statusView.setTextColor(Color.parseColor("#F43F5E"))
                        statusView.text = activity.getString(R.string.update_error, message)
                    }
                }
            )
        }

        btnPrimary.setOnClickListener { beginUpdate() }

        activeDialog = dialog
        dialog.show()
        btnPrimary.requestFocus()

        if (startDownloadImmediately) {
            beginUpdate()
        }
    }

    private fun showInstallPermissionDialog(info: AndroidUpdateInfo) {
        if (activity.isFinishing || activity.isDestroyed) return
        activeDialog?.dismiss()

        val dp = { value: Int ->
            TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value.toFloat(),
                activity.resources.displayMetrics
            ).toInt()
        }

        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#0F172A"))
                cornerRadius = dp(12).toFloat()
                setStroke(dp(1), Color.parseColor("#1E293B"))
            }
        }

        root.addView(TextView(activity).apply {
            text = activity.getString(R.string.update_permission_title)
            setTextColor(Color.parseColor("#10B981"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
        })

        root.addView(TextView(activity).apply {
            text = activity.getString(R.string.update_permission_message)
            setTextColor(Color.parseColor("#F0F6FC"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(16))
        })

        val btnRow = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        val btnCancel = createDialogButton(
            label = activity.getString(R.string.update_btn_cancel),
            bgColor = "#1E293B",
            borderColor = "#1E293B",
            textColor = "#F0F6FC",
            dp = dp
        )
        val btnAuthorize = createDialogButton(
            label = activity.getString(R.string.update_btn_authorize),
            bgColor = "#10B981",
            borderColor = "#10B981",
            textColor = "#06101E",
            dp = dp
        )

        val baseParams = LinearLayout.LayoutParams(0, dp(42), 1f)
        btnRow.addView(btnCancel, LinearLayout.LayoutParams(baseParams).apply { marginEnd = dp(8) })
        btnRow.addView(btnAuthorize, LinearLayout.LayoutParams(baseParams).apply { marginStart = dp(8) })
        root.addView(btnRow)

        val dialog = AlertDialog.Builder(activity)
            .setView(root)
            .setCancelable(true)
            .create()
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))

        btnCancel.setOnClickListener { dialog.dismiss() }
        btnAuthorize.setOnClickListener {
            dialog.dismiss()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                updateAwaitingInstallPermission = info
                val settingsIntent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")
                )
                try {
                    requestInstallPermission(settingsIntent)
                } catch (_: Exception) {
                    updateAwaitingInstallPermission = null
                    openExternalRelease(info.releaseUrl)
                }
            }
        }

        activeDialog = dialog
        dialog.show()
        btnAuthorize.requestFocus()
    }

    private fun createDialogButton(
        label: String,
        bgColor: String,
        borderColor: String,
        textColor: String,
        dp: (Int) -> Int
    ): Button {
        val normalBg = GradientDrawable().apply {
            setColor(Color.parseColor(bgColor))
            cornerRadius = dp(8).toFloat()
            setStroke(dp(1), Color.parseColor(borderColor))
        }
        val focusedBg = GradientDrawable().apply {
            setColor(Color.parseColor(bgColor))
            cornerRadius = dp(8).toFloat()
            setStroke(dp(2), Color.parseColor("#F59E0B"))
        }
        val stateBg = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), focusedBg)
            addState(intArrayOf(), normalBg)
        }

        return Button(activity).apply {
            text = label
            isAllCaps = false
            setTextColor(Color.parseColor(textColor))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTypeface(null, Typeface.BOLD)
            background = stateBg
            isFocusable = true
            isFocusableInTouchMode = false
        }
    }

    private fun startDownloadAndInstall(
        info: AndroidUpdateInfo,
        cancelFlag: AtomicBoolean,
        onProgress: (Int) -> Unit,
        onVerifying: () -> Unit,
        onLaunchingInstaller: (File) -> Unit,
        onError: (String) -> Unit
    ) {
        executor.execute {
            val updatesDir = File(activity.cacheDir, "updates")
            updatesDir.mkdirs()
            cleanOldUpdates(updatesDir)

            val safeAssetName = sanitizeAssetName(
                info.apkAssetName.ifBlank {
                    Uri.parse(info.apkDownloadUrl).lastPathSegment ?: "FluiStream-update.apk"
                }
            )
            val partFile = File(updatesDir, "$safeAssetName.part")
            val finalApk = File(updatesDir, safeAssetName)

            try {
                if (info.sha256SumsUrl.isBlank() || !isTrustedReleaseUrl(info.sha256SumsUrl)) {
                    throw IOException(activity.getString(R.string.update_hash_fetch_error))
                }

                val sumsContent = downloadText(info.sha256SumsUrl)
                val expectedSha256 = parseSha256FromSums(sumsContent, safeAssetName)
                    ?: throw IOException(activity.getString(R.string.update_hash_missing))

                val actualSha256 = downloadFileWithSha256(
                    url = info.apkDownloadUrl,
                    destFile = partFile,
                    cancelFlag = cancelFlag,
                    onProgress = onProgress
                )

                if (cancelFlag.get()) {
                    partFile.delete()
                    return@execute
                }

                onVerifying()

                if (!actualSha256.equals(expectedSha256, ignoreCase = true)) {
                    partFile.delete()
                    throw SecurityException(activity.getString(R.string.update_hash_mismatch))
                }

                if (finalApk.exists()) {
                    finalApk.delete()
                }
                if (!partFile.renameTo(finalApk)) {
                    partFile.copyTo(finalApk, overwrite = true)
                    partFile.delete()
                }

                NotificationManagerCompat.from(activity).cancel(UPDATE_NOTIFICATION_ID)
                onLaunchingInstaller(finalApk)
            } catch (e: Exception) {
                partFile.delete()
                if (!cancelFlag.get()) {
                    onError(e.message ?: "Unknown error")
                }
            }
        }
    }

    private fun downloadText(url: String): String {
        val conn = openHttpsConnection(url)
        return try {
            val code = conn.responseCode
            if (code !in 200..299) {
                throw IOException(activity.getString(R.string.update_hash_fetch_error))
            }
            conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun downloadFileWithSha256(
        url: String,
        destFile: File,
        cancelFlag: AtomicBoolean,
        onProgress: (Int) -> Unit
    ): String {
        val conn = openHttpsConnection(url)
        return try {
            val code = conn.responseCode
            if (code !in 200..299) {
                throw IOException("HTTP $code")
            }

            val totalBytes = conn.contentLengthLong
            val digest = MessageDigest.getInstance("SHA-256")
            var downloaded = 0L
            var lastReportedPct = -1

            conn.inputStream.use { input ->
                FileOutputStream(destFile).use { output ->
                    val buffer = ByteArray(16 * 1024)
                    while (true) {
                        if (cancelFlag.get()) {
                            return ""
                        }
                        val read = input.read(buffer)
                        if (read == -1) break
                        output.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                        downloaded += read
                        if (totalBytes > 0) {
                            val pct = ((downloaded * 100L) / totalBytes).toInt().coerceIn(0, 100)
                            if (pct != lastReportedPct) {
                                lastReportedPct = pct
                                onProgress(pct)
                            }
                        }
                    }
                    output.flush()
                }
            }

            digest.digest().joinToString("") { "%02x".format(Locale.US, it) }
        } finally {
            conn.disconnect()
        }
    }

    private fun openHttpsConnection(initialUrl: String): HttpURLConnection {
        var currentUrl = initialUrl
        var redirects = 0
        while (redirects <= MAX_REDIRECTS) {
            val parsed = Uri.parse(currentUrl)
            if (!"https".equals(parsed.scheme, ignoreCase = true)) {
                throw SecurityException("Insecure update URL rejected")
            }

            val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 15_000
                readTimeout = 30_000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "FluiStream-Android/${getInstalledVersionName()}")
                setRequestProperty("Accept", "*/*")
            }

            val code = conn.responseCode
            if (code in 301..308) {
                val location = conn.getHeaderField("Location")
                conn.disconnect()
                if (location.isNullOrBlank()) {
                    throw IOException("Empty redirect location")
                }
                currentUrl = URL(URL(currentUrl), location).toString()
                redirects++
                continue
            }
            return conn
        }
        throw IOException("Too many redirects")
    }

    private fun launchApkInstaller(apkFile: File) {
        val apkUri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.fileprovider",
            apkFile
        )
        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(apkUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            activity.startActivity(installIntent)
        } catch (_: Exception) {
            pendingUpdate?.releaseUrl?.let { openExternalRelease(it) }
        }
    }

    private fun openExternalRelease(releaseUrl: String) {
        val safeUrl = releaseUrl.ifBlank { "https://github.com/$GITHUB_REPO/releases/latest" }
        val parsed = Uri.parse(safeUrl)
        if (!"https".equals(parsed.scheme, ignoreCase = true)) return
        runCatching {
            activity.startActivity(Intent(Intent.ACTION_VIEW, parsed))
        }
    }

    private fun fetchLatestReleaseBlocking(): AndroidUpdateInfo? {
        return try {
            val conn = openHttpsConnection("https://api.github.com/repos/$GITHUB_REPO/releases/latest")
            val json = try {
                if (conn.responseCode !in 200..299) return null
                conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            } finally {
                conn.disconnect()
            }

            val root = JSONObject(json)
            val tagName = root.optString("tag_name", "")
            val cleanLatest = tagName.trim().removePrefix("v").removePrefix("V")
            val current = getInstalledVersionName()
            if (!isNewerVersion(cleanLatest, current)) return null

            var apkUrl = ""
            var apkName = ""
            var sumsUrl = ""
            val assets = root.optJSONArray("assets")
            if (assets != null) {
                for (i in 0 until assets.length()) {
                    val asset = assets.optJSONObject(i) ?: continue
                    val name = asset.optString("name", "")
                    val url = asset.optString("browser_download_url", "")
                    if (name.equals("SHA256SUMS.txt", ignoreCase = true)) {
                        sumsUrl = url
                    } else if (name.endsWith(".apk", ignoreCase = true)) {
                        if (apkUrl.isEmpty() || name.contains("android", ignoreCase = true)) {
                            apkUrl = url
                            apkName = name
                        }
                    }
                }
            }
            if (apkUrl.isEmpty() || !isTrustedReleaseUrl(apkUrl)) return null

            AndroidUpdateInfo(
                latestVersion = cleanLatest,
                title = activity.getString(R.string.update_available_title),
                body = activity.getString(R.string.update_available_header, current, cleanLatest),
                releaseNotes = root.optString("body", ""),
                apkDownloadUrl = apkUrl,
                apkAssetName = apkName,
                sha256SumsUrl = sumsUrl,
                releaseUrl = root.optString("html_url", "https://github.com/$GITHUB_REPO/releases/latest")
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun cleanOldUpdates(updatesDir: File) {
        updatesDir.listFiles()?.forEach { file ->
            if (file.isFile && (file.name.endsWith(".part") || file.name.endsWith(".apk"))) {
                file.delete()
            }
        }
    }

    private fun sanitizeAssetName(rawName: String): String {
        val base = File(rawName).name.replace(Regex("[^A-Za-z0-9._-]"), "_")
        return if (base.endsWith(".apk", ignoreCase = true)) base else "$base.apk"
    }

    companion object {
        const val ACTION_PROMPT_UPDATE = "com.cesarovies.fluistream.ACTION_PROMPT_UPDATE"
        private const val GITHUB_REPO = "CesarOvies/FluiStream"
        private const val FALLBACK_VERSION = "1.1.0"
        private const val CHANNEL_ID = "fluistream_updates"
        private const val UPDATE_NOTIFICATION_ID = 4102
        private const val MAX_REDIRECTS = 5

        fun isTrustedReleaseUrl(url: String): Boolean {
            if (url.isBlank()) return false
            val uri = Uri.parse(url)
            if (!"https".equals(uri.scheme, ignoreCase = true)) return false
            val host = uri.host?.lowercase(Locale.US) ?: return false
            val path = uri.path ?: return false
            return (host == "github.com" && path.startsWith("/$GITHUB_REPO/")) ||
                (host == "api.github.com" && path.startsWith("/repos/$GITHUB_REPO/"))
        }

        fun parseSha256FromSums(sumsContent: String, assetName: String): String? {
            if (sumsContent.isBlank() || assetName.isBlank()) return null
            val targetName = File(assetName).name
            for (rawLine in sumsContent.lineSequence()) {
                val line = rawLine.trim()
                if (line.isEmpty()) continue
                val match = Regex("^([0-9a-fA-F]{64})\\s+\\*?(.+)$").matchEntire(line) ?: continue
                val hash = match.groupValues[1]
                val filePart = match.groupValues[2].trim().removePrefix("./")
                if (File(filePart).name.equals(targetName, ignoreCase = true)) {
                    return hash
                }
            }
            return null
        }

        fun isNewerVersion(latestTag: String, currentVer: String): Boolean {
            val latest = parseSemver(latestTag) ?: return false
            val current = parseSemver(currentVer) ?: return false
            for (i in 0..2) {
                if (latest[i] > current[i]) return true
                if (latest[i] < current[i]) return false
            }
            return false
        }

        private fun parseSemver(raw: String): IntArray? {
            val clean = raw.trim().removePrefix("v").removePrefix("V").split('-', '+')[0]
            if (clean.isEmpty()) return null
            val parts = clean.split('.')
            val result = IntArray(3)
            for (i in 0 until minOf(parts.size, 3)) {
                result[i] = parts[i].toIntOrNull() ?: return null
            }
            return result
        }
    }
}

