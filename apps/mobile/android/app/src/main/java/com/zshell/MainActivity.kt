package com.zshell

import android.content.Context
import android.content.res.Configuration
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import androidx.core.content.ContextCompat
import androidx.core.graphics.ColorUtils
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  private var consoleBarColor: Int? = null

  companion object {
    const val PRIVACY_PREFS = "zshell_window_privacy"
    const val KEY_RECENTS_MASK = "recents_mask"

    @Volatile
    private var sensitiveContentVisible: Boolean = false

    @JvmStatic
    fun updateSensitiveContentVisible(sensitive: Boolean) {
      sensitiveContentVisible = sensitive
    }

    /** The recents mask defaults to on; only the settings toggle may disable it. */
    @JvmStatic
    fun recentsMaskEnabled(context: Context): Boolean =
        context.getSharedPreferences(PRIVACY_PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_RECENTS_MASK, true)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "ZShell"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * Recents/task-switcher privacy vs in-app screenshots. The console mirrors the
   * user's own machine screens, so the recents preview must not leak it — but the
   * user must also be able to screenshot their own console. Below Android 16 the
   * OS routes both captures through the same window flag (FLAG_SECURE), and the
   * task snapshot is taken when the transition to recents STARTS — before
   * onPause — so raising the flag "on the way out" is always too late (verified
   * on Android 15). API 36 separates the two: setRecentsScreenshotEnabled(false)
   * masks the preview without touching screenshots. On older versions the user
   * picks the priority in settings: mask on => always-secure window (in-app
   * screenshots blocked, like banking apps); mask off => screenshots work and
   * the preview shows content.
   */
  fun applyWindowPrivacy() {
    val mask = recentsMaskEnabled(this)
    if (Build.VERSION.SDK_INT >= 36) { // BAKLAVA
      setRecentsScreenshotEnabled(!mask)
      if (sensitiveContentVisible) {
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
      }
    } else if (mask || sensitiveContentVisible) {
      window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
    } else {
      window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
    }
  }

  fun setSensitiveContentVisible(sensitive: Boolean) {
    sensitiveContentVisible = sensitive
    applyWindowPrivacy()
  }

  /**
   * Some environments force edge-to-edge (Android 15+ with targetSdk 35+,
   * and Android containers like 卓易通 on HarmonyOS), drawing our content
   * under the status/navigation bars and breaking windowSoftInputMode=
   * adjustResize (the window no longer shrinks for the IME). Re-apply
   * system-bar + cutout + IME insets as padding on the content view so both
   * native UI and the WebView stay fully visible and inputs rise above the
   * keyboard. On normal non-edge-to-edge devices the delivered insets are
   * already consumed and this is a no-op.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    applyWindowPrivacy()
    applySystemBars()
    val content = findViewById<android.view.View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val bottom = if (ime.bottom > bars.bottom) ime.bottom else bars.bottom
      v.setPadding(bars.left, bars.top, bars.right, bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  /**
   * Day/night window chrome. uiMode is handled in-process (configChanges), so
   * the window background and bar colors are not re-inflated from the theme
   * on a scheme switch — re-resolve them from resources (values-night) and
   * flip the bar icon contrast to match.
   */
  @Suppress("DEPRECATION")
  fun applySystemBars(configOverride: Configuration? = null) {
    val night = when (AppearanceModule.storedMode(this)) {
      "light" -> false
      "dark" -> true
      else -> AppearanceModule.isNightConfig(
          configOverride ?: applicationContext.resources.configuration)
    }
    val resContext = if (AppearanceModule.isNightConfig(resources.configuration) == night) {
      this
    } else {
      val cfg = Configuration(resources.configuration)
      cfg.uiMode = (cfg.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
          if (night) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
      createConfigurationContext(cfg)
    }
    val bg = consoleBarColor ?: ContextCompat.getColor(resContext, R.color.app_background)
    val lightBg = ColorUtils.calculateLuminance(bg) > 0.5
    window.setBackgroundDrawable(ColorDrawable(bg))
    // On edge-to-edge Android the system bars can be transparent; the content
    // view owns the padded inset areas behind them.
    findViewById<android.view.View>(android.R.id.content)?.setBackgroundColor(bg)
    window.statusBarColor = bg
    window.navigationBarColor = bg
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.isAppearanceLightStatusBars = lightBg
    controller.isAppearanceLightNavigationBars = lightBg
  }

  fun setConsoleBarColor(color: Int?) {
    consoleBarColor = color
    applySystemBars()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val systemConfig = if (AppearanceModule.storedMode(this) == "system") newConfig else null
    applySystemBars(systemConfig)
    AppearanceModule.syncReactAppearance(getReactHost()?.currentReactContext, this, systemConfig)
  }

  override fun onNightModeChanged(mode: Int) {
    super.onNightModeChanged(mode)
    applySystemBars()
    AppearanceModule.syncReactAppearance(getReactHost()?.currentReactContext, this)
  }

  /**
   * Snapshot defense: hiding the window at pause time blanks the recents
   * preview on ROMs that ignore FLAG_SECURE for previews. It is only an extra
   * layer — on stock Android 15 the snapshot reads the surface's last retained
   * frame, so the real protection is FLAG_SECURE being applied for the whole
   * visible lifetime (see applyWindowPrivacy). The JS-thread relock renders
   * asynchronously — far too late for that snapshot — which is why this must
   * happen natively at pause time.
   */
  override fun onPause() {
    super.onPause()
    val inMultiWindow = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInMultiWindowMode
    if ((recentsMaskEnabled(this) || sensitiveContentVisible) && !inMultiWindow) {
      window.decorView.visibility = android.view.View.INVISIBLE
    }
  }

  override fun onResume() {
    super.onResume()
    window.decorView.visibility = android.view.View.VISIBLE
    if (AppearanceModule.storedMode(this) == "system" &&
        AppearanceModule.isNightConfig(resources.configuration) !=
            AppearanceModule.isNightConfig(applicationContext.resources.configuration)) {
      delegate.applyDayNight()
    }
    applySystemBars()
    AppearanceModule.syncReactAppearance(getReactHost()?.currentReactContext, this)
  }
}
