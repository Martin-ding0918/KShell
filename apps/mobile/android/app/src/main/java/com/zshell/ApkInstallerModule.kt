package com.zshell

import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.WebStorage
import androidx.core.content.FileProvider
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONArray
import org.json.JSONObject

private const val APK_MIME = "application/vnd.android.package-archive"

/**
 * In-app download manager backed by the system DownloadManager (no extra
 * third-party dependency). Own update downloads land in the app's private
 * external files dir and auto-launch the installer when complete. Downloads
 * enqueued by the embedded WebView (console pages) go to the public Downloads
 * dir; both are visible to [queryDownloads] because DownloadProvider filters
 * by caller uid.
 */
class ApkInstallerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "ApkInstaller"

  /** Metadata for downloads WE enqueued; survives app restarts in prefs. */
  private data class DownloadMeta(
      val id: Long,
      val fileName: String,
      val url: String,
      val kind: String,
      /** Stall watchdog: bytes seen at the last poll where progress happened. */
      val lastBytes: Long = 0L,
      /** Wall-clock ms of the last observed progress (0 = unknown). */
      val lastMoveAt: Long = 0L,
      /** Set when WE cancelled the download (stall watchdog); shown as failed. */
      val deadReason: String? = null,
      /** Optional expected SHA-256 hex digest for update APK verification. */
      val sha256: String? = null,
  )

  private val dm: DownloadManager
    get() = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

  private val prefs by lazy {
    reactContext.getSharedPreferences("zshell_downloads", Context.MODE_PRIVATE)
  }

  private val metaLock = Any()
  private val verifyExecutor = Executors.newSingleThreadExecutor()
  private val autoInstalledIds = mutableSetOf<Long>()
  private var receiverReady = false

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
      val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
      if (id <= 0L) return
      val meta = synchronized(metaLock) {
        val m = loadMetaLocked().firstOrNull { it.id == id }
        if (m == null || m.kind != KIND_UPDATE || !autoInstalledIds.add(id)) null else m
      } ?: return
      val isSuccessful = try {
        dm.query(DownloadManager.Query().setFilterById(id))?.use { c ->
          c.moveToFirst() &&
              c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) ==
                  DownloadManager.STATUS_SUCCESSFUL
        } == true
      } catch (_: Exception) {
        false
      }
      if (!isSuccessful) {
        synchronized(metaLock) { autoInstalledIds.remove(id) }
        return
      }
      val dir = downloadDir()
      if (dir == null) {
        synchronized(metaLock) { autoInstalledIds.remove(id) }
        return
      }
      val apk = File(dir, meta.fileName)
      try {
        verifyExecutor.execute {
          val (staged, failure) = stageAndVerifyUpdateApk(apk, meta.sha256)
          if (staged != null && failure == null) {
            installApk(staged)
          } else {
            apk.delete()
            recordVerificationFailure(id, failure ?: "安装包安全校验失败，已中止安装")
          }
        }
      } catch (_: Exception) {
        synchronized(metaLock) { autoInstalledIds.remove(id) }
      }
    }
  }

  override fun invalidate() {
    super.invalidate()
    synchronized(metaLock) {
      if (receiverReady) {
        try {
          reactContext.unregisterReceiver(receiver)
        } catch (_: Exception) {
          // already unregistered
        }
        receiverReady = false
      }
    }
    verifyExecutor.shutdownNow()
  }

  /**
   * Android 13+ requires an explicit export flag and some containers do not
   * treat DownloadManager broadcasts as protected system broadcasts. The
   * receiver only acts once per id after verifying DownloadManager STATUS_SUCCESSFUL
   * plus APK signature/package/SHA-256 integrity, so forged broadcasts cannot
   * replay or install untrusted packages.
   */
  private fun ensureReceiver() {
    synchronized(metaLock) {
      if (receiverReady) {
        return
      }
      val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          reactContext.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
          reactContext.registerReceiver(receiver, filter)
        }
        receiverReady = true
      } catch (_: Exception) {
        // Registration failure surfaces on the next download attempt instead.
      }
    }
  }

  private fun downloadDir(): File? =
      reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)

  // ---------- metadata persistence ----------

  private fun loadMetaLocked(): List<DownloadMeta> {
    try {
      val raw = prefs.getString(KEY_ITEMS, null) ?: return emptyList()
      val arr = JSONArray(raw)
      return (0 until arr.length()).mapNotNull { i ->
        val o = arr.optJSONObject(i) ?: return@mapNotNull null
        DownloadMeta(
            id = o.optLong("id"),
            fileName = o.optString("name"),
            url = o.optString("url"),
            kind = o.optString("kind", KIND_FILE),
            lastBytes = o.optLong("lastBytes"),
            lastMoveAt = o.optLong("lastMoveAt"),
            deadReason = o.optString("deadReason").ifEmpty { null },
            sha256 = o.optString("sha256").ifEmpty { null },
        )
      }
    } catch (_: Exception) {
      return emptyList()
    }
  }

  private fun saveMetaLocked(list: List<DownloadMeta>) {
    val arr = JSONArray()
    list.forEach { m ->
      val o = JSONObject()
          .put("id", m.id)
          .put("name", m.fileName)
          .put("url", m.url)
          .put("kind", m.kind)
          .put("lastBytes", m.lastBytes)
          .put("lastMoveAt", m.lastMoveAt)
      if (m.deadReason != null) {
        o.put("deadReason", m.deadReason)
      }
      if (m.sha256 != null) {
        o.put("sha256", m.sha256)
      }
      arr.put(o)
    }
    prefs.edit().putString(KEY_ITEMS, arr.toString()).apply()
  }

  private fun loadMeta(): List<DownloadMeta> = synchronized(metaLock) { loadMetaLocked() }

  private fun saveMeta(list: List<DownloadMeta>) = synchronized(metaLock) { saveMetaLocked(list) }

  // ---------- public bridge methods ----------

  /**
   * Enqueue one of OUR downloads (currently: update APKs) and resolve the
   * download id immediately. Completion is observed via [queryDownloads]
   * polling; update downloads verify package/signature/hash before installing.
   */
  @ReactMethod
  fun download(
      url: String,
      fileName: String,
      kind: String,
      expectedSha256: String?,
      promise: Promise
  ) {
    val dir = downloadDir()
    if (dir == null) {
      promise.reject("STORAGE", "外部存储不可用")
      return
    }
    ensureReceiver()
    val safeName = sanitizeFileName(fileName)
    val parsedUrl = Uri.parse(url)
    val scheme = parsedUrl.scheme?.lowercase()
    if (scheme != "https") {
      promise.reject("SCHEME", "仅支持 https 安全下载地址")
      return
    }
    val host = parsedUrl.host?.lowercase() ?: ""
    val port = parsedUrl.port
    if (kind == KIND_UPDATE &&
        (host !in TRUSTED_UPDATE_HOSTS ||
            (port != -1 && port != 443) ||
            !parsedUrl.userInfo.isNullOrEmpty())) {
      promise.reject("HOST", "不受信任的更新包下载地址")
      return
    }
    val normalizedSha256 = expectedSha256?.trim()?.lowercase()?.ifEmpty { null }
    if (normalizedSha256 != null && !SHA256_HEX_RE.matches(normalizedSha256)) {
      promise.reject("HASH", "更新包校验摘要格式无效")
      return
    }
    val request = try {
      buildRequest(parsedUrl, safeName, kind)
    } catch (e: Exception) {
      promise.reject("REQUEST", e.message ?: "下载请求无效", e)
      return
    }
    synchronized(metaLock) {
      val metas = loadMetaLocked().toMutableList()
      if (kind == KIND_UPDATE) {
        // Replace any previous update download/file first.
        metas.filter { it.kind == KIND_UPDATE }.forEach {
          dm.remove(it.id)
          autoInstalledIds.remove(it.id)
        }
        metas.removeAll { it.kind == KIND_UPDATE }
        dir.listFiles()?.forEach { if (it.name.endsWith(".apk")) it.delete() }
      }
      // Stale watchdog-cancelled rows served their purpose once a new download
      // starts; drop them so retrying doesn't leave duplicate failed entries.
      metas.removeAll { it.deadReason != null }
      val id = try {
        dm.enqueue(request)
      } catch (e: Exception) {
        promise.reject("ENQUEUE", e.message ?: "无法开始下载", e)
        return
      }
      metas.add(
          DownloadMeta(
              id = id,
              fileName = safeName,
              url = url,
              kind = kind,
              lastMoveAt = System.currentTimeMillis(),
              sha256 = normalizedSha256))
      saveMetaLocked(metas)
      promise.resolve(id.toDouble())
    }
  }

  /** Common DownloadManager request for our own downloads. */
  private fun buildRequest(
      parsedUrl: Uri,
      safeName: String,
      kind: String
  ): DownloadManager.Request =
      DownloadManager.Request(parsedUrl)
          .setTitle(if (kind == KIND_UPDATE) "KShell 更新" else safeName)
          .setDescription("下载完成后可在应用内打开")
          .setNotificationVisibility(
              DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
          .setDestinationInExternalFilesDir(
              reactContext, Environment.DIRECTORY_DOWNLOADS, safeName)
          .setAllowedOverMetered(true)
          .setAllowedOverRoaming(true)

  /** Restart an app-enqueued download. WebView downloads are left to
   * DownloadManager so it keeps their destination, partial data and headers. */
  @ReactMethod
  fun resumeDownload(id: Double, promise: Promise) {
    val lid = id.toLong()
    val meta = loadMeta().firstOrNull { it.id == lid && it.url.isNotEmpty() }
    if (meta == null) {
      promise.reject("RESUME", "控制台文件由系统自动续传；如失败，请回到网页重新下载")
      return
    }
    try {
      val paused = dm.query(DownloadManager.Query().setFilterById(lid))?.use { cursor ->
        cursor.moveToFirst() && cursor.getInt(
            cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) == DownloadManager.STATUS_PAUSED
      } == true
      if (!paused) {
        promise.reject("RESUME", "仅暂停中的下载可以继续")
        return
      }
      val parsedUri = Uri.parse(meta.url)
      val port = parsedUri.port
      if (parsedUri.scheme?.lowercase() != "https" ||
          (meta.kind == KIND_UPDATE &&
              (parsedUri.host?.lowercase() !in TRUSTED_UPDATE_HOSTS ||
                  (port != -1 && port != 443) ||
                  !parsedUri.userInfo.isNullOrEmpty()))) {
        promise.reject("RESUME", "下载地址不受信任")
        return
      }
      val request = buildRequest(parsedUri, meta.fileName, meta.kind)
      val newId = synchronized(metaLock) {
        dm.remove(lid)
        val enqueuedId = dm.enqueue(request)
        autoInstalledIds.remove(lid)
        saveMetaLocked(
            loadMetaLocked().filterNot { it.id == lid } +
                meta.copy(id = enqueuedId, lastBytes = 0L, lastMoveAt = System.currentTimeMillis()))
        enqueuedId
      }
      promise.resolve(newId.toDouble())
    } catch (e: Exception) {
      promise.reject("RESUME", e.message ?: "无法继续该下载", e)
    }
  }

  /**
   * All downloads owned by this app uid — ours plus anything the console
   * WebView enqueued — with live status from DownloadManager.
   */
  @ReactMethod
  fun queryDownloads(promise: Promise) {
    try {
      ensureReceiver()
      val now = System.currentTimeMillis()
      val out: WritableArray = Arguments.createArray()
      val stalledNames = mutableListOf<String>()
      synchronized(metaLock) {
        val metas = loadMetaLocked().toMutableList()
        val byId: MutableMap<Long, DownloadMeta> = metas.associateBy { it.id }.toMutableMap()
        val liveIds = mutableSetOf<Long>()
        val stalled = mutableListOf<DownloadMeta>()
        dm.query(DownloadManager.Query())?.use { cursor ->
          while (cursor.moveToNext()) {
            val id = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID))
            liveIds.add(id)
            val titleIdx = cursor.getColumnIndex(DownloadManager.COLUMN_TITLE)
            val cursorTitle = (if (titleIdx >= 0) cursor.getString(titleIdx) else null) ?: "下载"
            var meta = byId[id]
            if (meta == null) {
              // First time we see a uid download we didn't enqueue ourselves
              // (console WebView): start tracking it for the stall watchdog.
              meta = DownloadMeta(
                  id = id, fileName = cursorTitle, url = "", kind = KIND_FILE,
                  lastBytes = 0L, lastMoveAt = now)
              byId[id] = meta
              metas.add(meta)
            }

            val statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
            val status = if (statusIdx >= 0) cursor.getInt(statusIdx) else -1
            val reasonIdx = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
            val reason = if (reasonIdx >= 0) cursor.getInt(reasonIdx) else -1
            val bytesIdx = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
            val totalIdx = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
            val bytes = if (bytesIdx >= 0) cursor.getLong(bytesIdx) else 0L

            if (status == DownloadManager.STATUS_PENDING ||
                status == DownloadManager.STATUS_RUNNING) {
              if (bytes > meta.lastBytes) {
                byId[id] = meta.copy(lastBytes = bytes, lastMoveAt = now)
              } else if (meta.lastMoveAt == 0L) {
                // Legacy metadata from before the watchdog: start its clock now.
                byId[id] = meta.copy(lastMoveAt = now)
              } else if (meta.lastMoveAt in 1 until now - STALL_MS) {
                // No progress for a long time: cancel and surface it as failed
                // with a retry hint instead of leaving a zombie entry.
                stalled.add(meta.copy(deadReason = if (meta.url.isEmpty())
                  "长时间无响应，已自动取消，请回到控制台重新下载"
                else "长时间无响应，已自动取消"))
                stalledNames.add(meta.fileName.ifEmpty { cursorTitle })
                continue
              }
            } else if (status == DownloadManager.STATUS_PAUSED) {
              // User-paused: restart the stall grace for when it resumes.
              byId[id] = meta.copy(lastMoveAt = now)
            }

            meta = byId[id]!!
            val item: WritableMap = Arguments.createMap()
            item.putDouble("id", id.toDouble())
            item.putString("name", meta.fileName.ifEmpty { cursorTitle })
            item.putString("kind", meta.kind)
            item.putString("url", meta.url)
            if (meta.sha256 != null) {
              item.putString("sha256", meta.sha256)
            }
            when (status) {
              DownloadManager.STATUS_PENDING -> item.putString("status", "pending")
              DownloadManager.STATUS_RUNNING -> item.putString("status", "running")
              DownloadManager.STATUS_PAUSED -> {
                item.putString("status", "paused")
                item.putString("reason", pauseReasonText(reason))
              }
              DownloadManager.STATUS_SUCCESSFUL -> item.putString("status", "successful")
              DownloadManager.STATUS_FAILED -> {
                item.putString("status", "failed")
                item.putString("reason", reasonText(reason))
              }
              else -> item.putString("status", "running")
            }
            item.putDouble("bytesSoFar", bytes.toDouble())
            item.putDouble(
                "totalBytes",
                (if (totalIdx >= 0) cursor.getLong(totalIdx) else 0L).toDouble())
            out.pushMap(item)
          }
        }

        // Cancel the newly stalled ones after closing the cursor.
        for (dead in stalled) {
          try {
            dm.remove(dead.id)
          } catch (_: Exception) {
            // already gone
          }
          liveIds.remove(dead.id)
          byId[dead.id] = dead
        }

        // Persist the (possibly updated) watchdog state; emit ALL cancelled rows
        // (both newly stalled and previously persisted) so they remain visible
        // across polls until the user deletes or retries them.
        val keep = metas.map { byId[it.id] ?: it }.filter { it.id in liveIds || it.deadReason != null }
        for (dead in keep) {
          if (dead.id !in liveIds && dead.deadReason != null) {
            val item: WritableMap = Arguments.createMap()
            item.putDouble("id", dead.id.toDouble())
            item.putString("name", dead.fileName)
            item.putString("kind", dead.kind)
            item.putString("url", dead.url)
            if (dead.sha256 != null) {
              item.putString("sha256", dead.sha256)
            }
            item.putString("status", "failed")
            item.putString("reason", dead.deadReason)
            item.putDouble("bytesSoFar", 0.0)
            item.putDouble("totalBytes", 0.0)
            out.pushMap(item)
          }
        }
        saveMetaLocked(keep)
      }
      promise.resolve(out)

      if (stalledNames.isNotEmpty()) {
        val text = stalledNames.joinToString("、")
        try {
          reactContext.getNativeModule(NotificationsModule::class.java)
              ?.notify(6.0, "下载已自动取消", "「$text」长时间无响应，请在下载管理查看")
        } catch (_: Exception) {
          // notification is best-effort
        }
      }
    } catch (e: Exception) {
      promise.reject("QUERY", "无法读取下载列表", e)
    }
  }

  /** Cancel (running) or delete (finished) a download; also removes its file. */
  @ReactMethod
  fun removeDownload(id: Double, promise: Promise) {
    val lid = id.toLong()
    try {
      dm.remove(lid)
      synchronized(metaLock) {
        autoInstalledIds.remove(lid)
        saveMetaLocked(loadMetaLocked().filterNot { it.id == lid })
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("REMOVE", e.message ?: "无法移除该下载", e)
    }
  }

  /** Open a finished download: ours via FileProvider, console ones via the
   * downloads provider content uri. Update APKs are verified before install. */
  @ReactMethod
  fun openDownloadedFile(id: Double, promise: Promise) {
    val lid = id.toLong()
    val meta = loadMeta().firstOrNull { it.id == lid }
    try {
      if (meta != null && meta.url.isNotEmpty()) {
        val dir = downloadDir() ?: error("外部存储不可用")
        val canonicalDir = dir.canonicalFile
        val file = File(dir, meta.fileName)
        val canonicalFile = file.canonicalFile
        if (canonicalFile.parentFile != canonicalDir) {
          promise.reject("OPEN", "文件路径无效")
          return
        }
        if (!canonicalFile.isFile) {
          promise.reject("OPEN", "文件不存在（可能已被清理）")
          return
        }
        if (meta.kind == KIND_UPDATE) {
          try {
            verifyExecutor.execute {
              val (staged, failure) = stageAndVerifyUpdateApk(canonicalFile, meta.sha256)
              if (staged == null || failure != null) {
                canonicalFile.delete()
                recordVerificationFailure(lid, failure ?: "安装包安全校验失败，已中止安装")
                promise.reject("VERIFY", failure ?: "安装包安全校验失败，已中止安装")
                return@execute
              }
              try {
                val uri = FileProvider.getUriForFile(
                    reactContext, "${reactContext.packageName}.fileprovider", staged)
                viewFile(uri, APK_MIME, promise)
              } catch (e: Exception) {
                promise.reject("OPEN", e.message ?: "无法打开安装包", e)
              }
            }
          } catch (e: Exception) {
            promise.reject("OPEN", e.message ?: "无法打开安装包", e)
          }
          return
        }
        val uri =
            FileProvider.getUriForFile(
                reactContext, "${reactContext.packageName}.fileprovider", canonicalFile)
        viewFile(uri, mimeFor(meta.fileName), promise)
      } else {
        val uri = dm.getUriForDownloadedFile(lid)
        if (uri == null) {
          promise.reject("OPEN", "下载未完成或文件已被移除")
          return
        }
        viewFile(uri, downloadMime(lid), promise)
      }
    } catch (e: Exception) {
      promise.reject("OPEN", e.message ?: "无法打开文件", e)
    }
  }

  /** Write text to a cache file and offer it via the system share sheet
   * (used for encrypted backups). */
  @ReactMethod
  fun shareTextFile(fileName: String, text: String, promise: Promise) {
    try {
      val safeName = sanitizeFileName(fileName).ifEmpty { "zshell-backup.txt" }
      val shareDir = File(reactContext.cacheDir, "share")
      shareDir.mkdirs()
      val target = File(shareDir, safeName)
      target.writeText(text, Charsets.UTF_8)
      val uri =
          FileProvider.getUriForFile(
              reactContext, "${reactContext.packageName}.fileprovider", target)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(Intent.createChooser(send, null).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      })
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("SHARE", e.message ?: "无法分享文件", e)
    }
  }

  /** Open the system Downloads screen (where console-file downloads live). */
  @ReactMethod
  fun openDownloadsUi(promise: Promise) {
    try {
      val intent = Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("DOWNLOADS_UI", e.message ?: "无法打开系统下载列表", e)
    }
  }

  /** Open a URL in a real browser (BROWSABLE category), not an app chooser. */
  @ReactMethod
  fun openUrlInBrowser(url: String, promise: Promise) {
    try {
      val uri = Uri.parse(url)
      val scheme = uri.scheme?.lowercase()
      if (scheme != "https" && scheme != "http") {
        promise.reject("BROWSER", "仅支持在浏览器中打开 http/https 链接")
        return
      }
      val browser = Intent(Intent.ACTION_VIEW, uri).apply {
        addCategory(Intent.CATEGORY_BROWSABLE)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      val resolved = reactContext.packageManager.resolveActivity(
          browser, PackageManager.MATCH_DEFAULT_ONLY)
      val target = if (resolved != null) browser
          else Intent(Intent.ACTION_VIEW, uri).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
      reactContext.startActivity(target)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BROWSER", e.message ?: "无法打开浏览器", e)
    }
  }

  // ---------- update-apk housekeeping (kept for launch cleanup) ----------

  /** Names (zshell-update-<version>.apk) of update APKs still on disk. */
  @ReactMethod
  fun listUpdateApks(promise: Promise) {
    try {
      val dir = reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
      val names = dir
          ?.listFiles()
          ?.filter { it.isFile && it.name.startsWith(UPDATE_PREFIX) && it.name.endsWith(".apk") }
          ?.map { it.name }
          ?: emptyList<String>()
      promise.resolve(Arguments.fromList(names))
    } catch (e: Exception) {
      promise.reject("LIST_APKS", e.message ?: "无法读取更新缓存", e)
    }
  }

  /** Delete one update APK by exact name (only in the update dir). */
  @ReactMethod
  fun deleteUpdateApk(name: String) {
    try {
      if (!name.startsWith(UPDATE_PREFIX) ||
          !name.endsWith(".apk") ||
          name.contains('/') ||
          name.contains('\\') ||
          name.contains("..")) {
        return
      }
      // Removing the DownloadManager record also deletes its file — and the
      // record is what keeps a long-installed update visible in 下载管理.
      synchronized(metaLock) {
        val metas = loadMetaLocked().toMutableList()
        val doomed = metas.filter { it.kind == KIND_UPDATE && it.fileName == name }
        if (doomed.isNotEmpty()) {
          dm.remove(*doomed.map { it.id }.toLongArray())
          doomed.forEach { autoInstalledIds.remove(it.id) }
          metas.removeAll { it.kind == KIND_UPDATE && it.fileName == name }
          saveMetaLocked(metas)
        }
      }
      val stageDir = File(reactContext.cacheDir, "updates").canonicalFile
      val stagedTarget = File(stageDir, name).canonicalFile
      if (stagedTarget.parentFile == stageDir && stagedTarget.exists()) {
        stagedTarget.delete()
      }
      // Fallback for files whose record is already gone (canonical boundary check).
      val dir = reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return
      val canonicalDir = dir.canonicalFile
      val target = File(canonicalDir, name).canonicalFile
      if (target.parentFile == canonicalDir && target.exists()) {
        target.delete()
      }
    } catch (_: Exception) {
      // cleanup is best-effort
    }
  }

  // ---------- web login state ----------

  /**
   * Wipe all WebView cookies and web storage (localStorage etc.) held by this
   * app — i.e. log the console pages (Kimi Code account, any web session)
   * out. Pairing credentials in encrypted storage are NOT touched.
   */
  @ReactMethod
  fun clearWebSession(promise: Promise) {
    val settled = AtomicBoolean(false)
    try {
      val cookies = CookieManager.getInstance()
      cookies.removeAllCookies { _ ->
        try {
          cookies.removeSessionCookies { _ ->
            try {
              cookies.flush()
              WebStorage.getInstance().deleteAllData()
              if (settled.compareAndSet(false, true)) {
                promise.resolve(true)
              }
            } catch (e: Exception) {
              if (settled.compareAndSet(false, true)) {
                promise.reject("CLEAR_WEB", e.message ?: "清除失败", e)
              }
            }
          }
        } catch (e: Exception) {
          if (settled.compareAndSet(false, true)) {
            promise.reject("CLEAR_WEB", e.message ?: "清除失败", e)
          }
        }
      }
    } catch (e: Exception) {
      if (settled.compareAndSet(false, true)) {
        promise.reject("CLEAR_WEB", e.message ?: "清除失败", e)
      }
    }
  }

  // ---------- helpers ----------

  /**
   * Copy an update APK from external downloads into app-private cache before
   * verifying and handing it to the system installer, eliminating external
   * storage TOCTOU swaps between verification and install.
   */
  private fun stageAndVerifyUpdateApk(
      sourceApk: File,
      expectedSha256: String?,
  ): Pair<File?, String?> {
    var staged: File? = null
    try {
      val downloadRoot = downloadDir()?.canonicalFile ?: return Pair(null, "外部存储不可用")
      val canonicalSource = sourceApk.canonicalFile
      if (canonicalSource.parentFile != downloadRoot || !canonicalSource.isFile) {
        return Pair(null, "安装包路径无效")
      }
      val stageDir = File(reactContext.cacheDir, "updates")
      if (!stageDir.exists() && !stageDir.mkdirs()) {
        return Pair(null, "无法准备私有校验目录")
      }
      val canonicalStageDir = stageDir.canonicalFile
      canonicalStageDir.listFiles()?.forEach { it.delete() }
      val safeName = sanitizeFileName(canonicalSource.name)
      val target = File(canonicalStageDir, safeName)
      if (target.canonicalFile.parentFile != canonicalStageDir) {
        return Pair(null, "安装包路径无效")
      }
      canonicalSource.copyTo(target, overwrite = true)
      staged = target
      val failure = verifyUpdateApk(target, canonicalStageDir, expectedSha256)
      if (failure != null) {
        target.delete()
        return Pair(null, failure)
      }
      return Pair(target, null)
    } catch (_: Exception) {
      staged?.delete()
      return Pair(null, "安装包安全校验失败，已中止安装")
    }
  }

  /** Mark an update download failed after integrity/signature verification fails. */
  private fun recordVerificationFailure(id: Long, reason: String) {
    try {
      dm.remove(id)
    } catch (_: Exception) {
      // already gone
    }
    synchronized(metaLock) {
      autoInstalledIds.remove(id)
      val updated = loadMetaLocked().map { m ->
        if (m.id == id) m.copy(deadReason = reason) else m
      }
      saveMetaLocked(updated)
    }
  }

  /**
   * Verify a staged app-private update APK before handing it to the system
   * package installer:
   * 1. File resides strictly inside our app-private staging directory.
   * 2. If GitHub release metadata supplied a SHA-256 digest, the file matches it.
   * 3. Archive package name and signing certificate match the running app.
   * Returns null when valid, or a user-facing error message on mismatch.
   */
  private fun verifyUpdateApk(
      apk: File,
      expectedParentDir: File,
      expectedSha256: String?,
  ): String? {
    try {
      val canonicalApk = apk.canonicalFile
      if (canonicalApk.parentFile != expectedParentDir || !canonicalApk.isFile) {
        return "安装包路径无效"
      }
      if (expectedSha256 != null) {
        val actual = sha256Hex(canonicalApk)
        if (!actual.equals(expectedSha256, ignoreCase = true)) {
          return "安装包完整性校验失败（SHA-256 不匹配），已取消安装"
        }
      }
      val pm = reactContext.packageManager
      val archiveInfo = readPackageArchiveInfo(pm, canonicalApk.path)
          ?: return "安装包解析失败，文件可能已损坏"
      if (archiveInfo.packageName != reactContext.packageName) {
        return "安装包包名与当前应用不一致，已中止安装"
      }
      val archiveSigs = signingCertDigests(archiveInfo)
      val installedInfo = readInstalledPackageInfo(pm, reactContext.packageName)
          ?: return "无法校验当前应用签名"
      val installedSigs = signingCertDigests(installedInfo)
      if (archiveSigs.isEmpty() || archiveSigs != installedSigs) {
        return "安装包签名与当前应用不一致，已中止安装"
      }
      return null
    } catch (_: Exception) {
      return "安装包安全校验失败，已中止安装"
    }
  }

  @Suppress("DEPRECATION")
  private fun readPackageArchiveInfo(pm: PackageManager, apkPath: String): PackageInfo? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.getPackageArchiveInfo(
            apkPath,
            PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()))
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        pm.getPackageArchiveInfo(apkPath, PackageManager.GET_SIGNING_CERTIFICATES)
      } else {
        pm.getPackageArchiveInfo(apkPath, PackageManager.GET_SIGNATURES)
      }

  @Suppress("DEPRECATION")
  private fun readInstalledPackageInfo(pm: PackageManager, pkg: String): PackageInfo? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.getPackageInfo(
            pkg,
            PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()))
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
      } else {
        pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES)
      }

  @Suppress("DEPRECATION")
  private fun signingCertDigests(info: PackageInfo): Set<String> {
    val sigs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val signingInfo = info.signingInfo ?: return emptySet()
      if (signingInfo.hasMultipleSigners()) signingInfo.apkContentsSigners
      else signingInfo.signingCertificateHistory
    } else {
      info.signatures
    } ?: return emptySet()
    val md = MessageDigest.getInstance("SHA-256")
    return sigs.map { sig ->
      md.reset()
      md.digest(sig.toByteArray()).joinToString("") { "%02x".format(it) }
    }.toSet()
  }

  private fun sha256Hex(file: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    val buf = ByteArray(16 * 1024)
    FileInputStream(file).use { input ->
      while (true) {
        val n = input.read(buf)
        if (n <= 0) break
        md.update(buf, 0, n)
      }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
  }

  private fun installApk(apk: File): Boolean = try {
    val uri =
        FileProvider.getUriForFile(
            reactContext, "${reactContext.packageName}.fileprovider", apk)
    val install = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, APK_MIME)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    reactContext.startActivity(install)
    true
  } catch (_: Exception) {
    false
  }

  private fun viewFile(uri: Uri, mime: String, promise: Promise) {
    val view = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, mime)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    try {
      reactContext.startActivity(view)
      promise.resolve(null)
    } catch (e: ActivityNotFoundException) {
      promise.reject("OPEN", "本机没有能打开该文件的应用", e)
    }
  }

  private fun mimeFor(fileName: String): String {
    if (fileName.endsWith(".apk", ignoreCase = true)) {
      return APK_MIME
    }
    val ext = MimeTypeMap.getFileExtensionFromUrl(fileName)
    return if (ext != null)
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.lowercase())
            ?: "application/octet-stream"
    else
        "application/octet-stream"
  }

  /** Media type recorded by DownloadManager for webview-initiated files. */
  private fun downloadMime(id: Long): String = try {
    var mime = "application/octet-stream"
    dm.query(DownloadManager.Query().setFilterById(id))?.use { cursor ->
      if (cursor.moveToFirst()) {
        val idx = cursor.getColumnIndex(DownloadManager.COLUMN_MEDIA_TYPE)
        if (idx >= 0 && !cursor.isNull(idx) && cursor.getString(idx).isNotEmpty()) {
          mime = cursor.getString(idx)
        }
      }
    }
    mime
  } catch (_: Exception) {
    "application/octet-stream"
  }

  companion object {
    private const val KEY_ITEMS = "items"
    private const val KIND_UPDATE = "update"
    private const val KIND_FILE = "file"
    private const val UPDATE_PREFIX = "zshell-update-"
    private val TRUSTED_UPDATE_HOSTS = setOf(
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    )
    private val SHA256_HEX_RE = Regex("^[0-9a-f]{64}$")
    /** Stall watchdog: cancel a pending/running download with no byte
     * progress for this long (checked whenever any screen polls the list). */
    private const val STALL_MS = 2 * 60 * 1000L

    /** Strip path separators / reserved chars / dot-traversal; keep it short and safe. */
    private fun sanitizeFileName(name: String): String {
      val cleaned = name
          .replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]"), "_")
          .replace("..", "_")
          .trim()
          .trimStart('.')
      val bounded = if (cleaned.length > 80) cleaned.substring(0, 80) else cleaned
      return if (bounded.isEmpty() || bounded == "." || bounded == "..") "download" else bounded
    }

    /** Human-readable reason for a failed DownloadManager entry. */
    private fun reasonText(reason: Int): String = when {
      reason in 400..599 -> "HTTP $reason（国内网络访问 GitHub 可能需要代理）"
      reason == DownloadManager.ERROR_FILE_ERROR -> "文件写入错误"
      reason == DownloadManager.ERROR_DEVICE_NOT_FOUND -> "存储不可用"
      reason == DownloadManager.ERROR_INSUFFICIENT_SPACE -> "存储空间不足"
      reason == DownloadManager.ERROR_UNHANDLED_HTTP_CODE -> "服务器返回异常状态"
      reason == DownloadManager.ERROR_TOO_MANY_REDIRECTS -> "重定向过多"
      reason == DownloadManager.ERROR_CANNOT_RESUME -> "无法续传"
      reason == DownloadManager.ERROR_HTTP_DATA_ERROR -> "数据传输错误"
      else -> "原因代码 $reason"
    }

    /** Why a download is sitting in the paused state. */
    private fun pauseReasonText(reason: Int): String = when (reason) {
      DownloadManager.PAUSED_WAITING_FOR_NETWORK -> "等待网络恢复"
      DownloadManager.PAUSED_WAITING_TO_RETRY -> "等待重试"
      DownloadManager.PAUSED_QUEUED_FOR_WIFI -> "等待 Wi-Fi"
      7 -> "等待设备空闲" // PAUSED_QUEUED_FOR_DEVICE is not in the public API
      else -> "已暂停"
    }
  }
}

class ApkInstallerPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext) =
      listOf(
          ApkInstallerModule(reactContext),
          CryptoModule(reactContext),
          NotificationsModule(reactContext),
          PrivacyWindowModule(reactContext),
          AppearanceModule(reactContext))

  override fun createViewManagers(
      reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
