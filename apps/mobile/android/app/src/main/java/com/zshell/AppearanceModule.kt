package com.zshell

import android.content.Context
import android.graphics.Color
import androidx.appcompat.app.AppCompatDelegate
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

/**
 * Light / dark preference bridge. The mode is kept in SharedPreferences and
 * applied through AppCompatDelegate, so it takes effect before the first
 * frame on a cold start (see MainApplication.onCreate) and system dialogs
 * follow the in-app choice too. MainActivity declares uiMode in configChanges,
 * so switching never recreates the activity (keep-alive consoles survive);
 * MainActivity.onConfigurationChanged refreshes the window colors instead.
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
  }

  override fun getName() = "ZShellAppearance"

  override fun getConstants(): Map<String, Any> =
      mapOf("themeMode" to storedMode(reactApplicationContext))

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
    }
  }
}
