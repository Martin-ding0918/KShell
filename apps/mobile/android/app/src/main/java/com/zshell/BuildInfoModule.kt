package com.zshell

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

/**
 * Build-channel constants for the JS layer. `CHANNEL` and `PROJECT_PAGE` come
 * from the product flavor (see app/build.gradle), so a single JS bundle can
 * tell the public and self-use builds apart without an update-check round
 * trip (the self-use build has no public releases to check).
 */
class BuildInfoModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "ZShellBuild"

  override fun getConstants(): Map<String, Any> =
      mapOf(
          "channel" to BuildConfig.CHANNEL,
          "projectPage" to BuildConfig.PROJECT_PAGE,
          "versionName" to BuildConfig.VERSION_NAME,
          "versionCode" to BuildConfig.VERSION_CODE,
      )
}
