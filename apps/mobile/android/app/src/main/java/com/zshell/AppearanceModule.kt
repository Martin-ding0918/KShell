package com.zshell

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import androidx.appcompat.app.AppCompatDelegate
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.appearance.AppearanceModule as RnAppearanceModule

/**
 * Light / dark preference bridge. The mode is kept in SharedPreferences and
 * applied through AppCompatDelegate, so it takes effect before the first
 * frame on a cold start (see MainApplication.onCreate) and system dialogs
 * follow the in-app choice too. MainActivity declares uiMode in configChanges,
 * so switching never recreates the activity (keep-alive consoles survive);
 * MainActivity refreshes window colors and syncs React Native's Appearance
 * module on configuration change, night-mode change, and foreground resume.
 */
class AppearanceModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val PREFS = "zshell_appearance"
    private const val KEY_MODE = "theme_mode"

    @JvmStatic
    fun storedMode(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_MODE, "system") ?: "system"

    @JvmStatic
    fun nightModeFor(mode: String): Int =
        when (mode) {
          "light" -> AppCompatDelegate.MODE_NIGHT_NO
          "dark" -> AppCompatDelegate.MODE_NIGHT_YES
          else -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
        }

    @JvmStatic
    fun isNightConfig(config: Configuration): Boolean =
        (config.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    /**
     * Resolve the OS-level light/dark scheme. Reading Application resources
     * avoids stale Activity configurations after background uiMode changes on
     * Android / OEM ROMs (e.g. HyperOS) where Activity delivery is deferred.
     */
    @JvmStatic
    fun systemColorScheme(context: Context, config: Configuration? = null): String {
      val cfg = config ?: context.applicationContext.resources.configuration
      return if (isNightConfig(cfg)) "dark" else "light"
    }

    /** Push the current OS scheme to React Native's AppearanceModule when active. */
    @JvmStatic
    fun syncReactAppearance(
        reactContext: ReactContext?,
        context: Context,
        config: Configuration? = null,
    ) {
      val ctx = reactContext ?: return
      if (!ctx.hasActiveReactInstance()) return
      val rnAppearance = ctx.getNativeModule(RnAppearanceModule::class.java) ?: return
      rnAppearance.emitAppearanceChanged(systemColorScheme(context, config))
    }
  }

  override fun getName() = "ZShellAppearance"

  override fun getConstants(): Map<String, Any> =
      mapOf("themeMode" to storedMode(reactApplicationContext))

  @ReactMethod
  fun getSystemColorScheme(promise: Promise) {
    promise.resolve(systemColorScheme(reactApplicationContext))
  }

  @ReactMethod
  fun setConsoleBarColor(color: String?) {
    val parsed = color?.takeIf { it.matches(Regex("#[0-9a-fA-F]{6}")) }?.let(Color::parseColor)
    UiThreadUtil.runOnUiThread {
      (reactApplicationContext.currentActivity as? MainActivity)?.setConsoleBarColor(parsed)
    }
  }

  @ReactMethod
  fun setThemeMode(mode: String) {
    val normalized = if (mode == "light" || mode == "dark") mode else "system"
    reactApplicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_MODE, normalized)
        .apply()
    UiThreadUtil.runOnUiThread {
      AppCompatDelegate.setDefaultNightMode(nightModeFor(normalized))
      val activity = reactApplicationContext.currentActivity
      if (activity is MainActivity) {
        activity.applySystemBars()
      }
      syncReactAppearance(reactApplicationContext, reactApplicationContext)
    }
  }
}
