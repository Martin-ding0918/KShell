package com.zshell

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.SecureRandom
import java.util.concurrent.Executors
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Secure-random bytes and off-thread PBKDF2-HMAC-SHA256. */
class CryptoModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private val kdfExecutor = Executors.newSingleThreadExecutor()
  private val rng = SecureRandom()

  override fun getName() = "ZShellCrypto"

  override fun invalidate() {
    super.invalidate()
    kdfExecutor.shutdownNow()
  }

  @ReactMethod
  fun secureRandomBase64(count: Double, promise: Promise) {
    try {
      if (!count.isFinite() || count != Math.floor(count) || count < 1.0 || count > 256.0) {
        promise.reject("INVALID_ARG", "随机数长度必须在 1 到 256 之间")
        return
      }
      val bytes = ByteArray(count.toInt())
      try {
        rng.nextBytes(bytes)
        promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP))
      } finally {
        bytes.fill(0)
      }
    } catch (e: Exception) {
      promise.reject("RANDOM", e.message ?: "无法生成随机数", e)
    }
  }

  /**
   * PBKDF2-HMAC-SHA256 over raw bytes (RFC 2898) running on a dedicated
   * background thread so high iteration counts (e.g. 600k backup KDF) never
   * block the NativeModules bridge thread. Must stay byte-for-byte identical
   * to packages/core-shell/src/crypto.ts pbkdf2Sha256.
   */
  @ReactMethod
  fun pbkdf2Sha256Base64(
      passwordB64: String,
      saltB64: String,
      iterations: Double,
      dkLen: Double,
      promise: Promise
  ) {
    if (!iterations.isFinite() || iterations != Math.floor(iterations) ||
        iterations < 1.0 || iterations > 1_000_000.0) {
      promise.reject("INVALID_ARG", "迭代次数无效")
      return
    }
    if (!dkLen.isFinite() || dkLen != Math.floor(dkLen) ||
        dkLen < 1.0 || dkLen > 512.0) {
      promise.reject("INVALID_ARG", "派生密钥长度无效")
      return
    }
    val iters = iterations.toInt()
    val outLen = dkLen.toInt()
    kdfExecutor.execute {
      var password: ByteArray? = null
      var salt: ByteArray? = null
      var keyBytes: ByteArray? = null
      var out: ByteArray? = null
      var result: ByteArray? = null
      try {
        password = Base64.decode(passwordB64, Base64.NO_WRAP)
        salt = Base64.decode(saltB64, Base64.NO_WRAP)
        // JCA SecretKeySpec rejects 0-length keys; in RFC 2104 HMAC-SHA256 an
        // empty key is zero-padded to the 64-byte block size, identical to a
        // single 0x00 byte key.
        keyBytes = if (password.isEmpty()) ByteArray(1) else password.copyOf()
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(keyBytes, "HmacSHA256"))
        val blocks = (outLen + 31) / 32
        out = ByteArray(blocks * 32)
        val saltBlock = ByteArray(salt.size + 4)
        System.arraycopy(salt, 0, saltBlock, 0, salt.size)
        try {
          for (i in 1..blocks) {
            saltBlock[salt.size] = (i ushr 24).toByte()
            saltBlock[salt.size + 1] = (i ushr 16).toByte()
            saltBlock[salt.size + 2] = (i ushr 8).toByte()
            saltBlock[salt.size + 3] = i.toByte()
            var u = mac.doFinal(saltBlock)
            val t = u.copyOf()
            try {
              for (iter in 1 until iters) {
                val nextU = mac.doFinal(u)
                u.fill(0)
                u = nextU
                for (j in t.indices) {
                  t[j] = (t[j].toInt() xor u[j].toInt()).toByte()
                }
              }
              System.arraycopy(t, 0, out, (i - 1) * 32, 32)
            } finally {
              u.fill(0)
              t.fill(0)
            }
          }
        } finally {
          saltBlock.fill(0)
        }
        result = if (outLen == out.size) out.copyOf() else out.copyOf(outLen)
        promise.resolve(Base64.encodeToString(result, Base64.NO_WRAP))
      } catch (e: Exception) {
        promise.reject("PBKDF2", e.message ?: "密钥派生失败", e)
      } finally {
        password?.fill(0)
        salt?.fill(0)
        keyBytes?.fill(0)
        out?.fill(0)
        result?.fill(0)
      }
    }
  }
}
