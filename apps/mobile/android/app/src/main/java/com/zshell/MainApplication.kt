package com.zshell

import android.app.Application
import android.content.res.Configuration
import androidx.appcompat.app.AppCompatDelegate
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  @Volatile private var reactHostInitialized = false

  override val reactHost: ReactHost by lazy {
    reactHostInitialized = true
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(ApkInstallerPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Apply the stored light/dark choice before any activity inflates.
    AppCompatDelegate.setDefaultNightMode(
        AppearanceModule.nightModeFor(AppearanceModule.storedMode(this)))
    loadReactNative(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    // System dark/light toggles while the Activity is backgrounded reach
    // Application.onConfigurationChanged even when Activity delivery is deferred.
    if (reactHostInitialized) {
      AppearanceModule.syncReactAppearance(reactHost.currentReactContext, this, newConfig)
    }
  }
}
