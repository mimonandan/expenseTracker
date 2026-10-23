package com.paisapilot.app

import android.content.Intent
import android.content.Context
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import org.json.JSONArray
import org.json.JSONObject

class TransactionCaptureModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "TransactionCapture"

  @ReactMethod
  fun openSettings() {
    val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
    reactApplicationContext.startActivity(intent)
  }

  @ReactMethod
  fun hasAccess(promise: Promise) {
    val enabled = Settings.Secure.getString(reactApplicationContext.contentResolver, "enabled_notification_listeners").orEmpty()
    promise.resolve(enabled.contains(reactApplicationContext.packageName))
  }

  @ReactMethod
  fun encryptLocalData(value: String, promise: Promise) {
    try { promise.resolve(TransactionCaptureService.encryptLocalData(value)) }
    catch (error: Exception) { promise.reject("LOCAL_DATA_ENCRYPT_FAILED", "Could not protect local spending data.", error) }
  }

  @ReactMethod
  fun decryptLocalData(value: String, promise: Promise) {
    try { promise.resolve(TransactionCaptureService.decryptLocalData(value)) }
    catch (error: Exception) { promise.reject("LOCAL_DATA_DECRYPT_FAILED", "Could not unlock local spending data. Keep this app installation and try again.", error) }
  }

  @ReactMethod
  fun setCaptureActive(active: Boolean, promise: Promise) {
    try {
      synchronized(TransactionCaptureService.LOCK) {
        val prefs = reactApplicationContext.getSharedPreferences(TransactionCaptureService.PREFS, Context.MODE_PRIVATE)
        val editor = prefs.edit().putBoolean(TransactionCaptureService.ACTIVE_KEY, active)
        if (!active) editor.remove(TransactionCaptureService.CHECK_COUNT_KEY)
          .remove(TransactionCaptureService.LAST_CHECK_KEY)
        editor.apply()
        if (!active) {
          TransactionCaptureService.clearPendingTransactions(reactApplicationContext)
          TransactionCaptureService.clearAiCandidates(reactApplicationContext)
        }
      }
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("CAPTURE_STATE_FAILED", "Could not update transaction capture state.", error)
    }
  }

  @ReactMethod
  fun setAiFallbackEnabled(enabled: Boolean, promise: Promise) {
    try {
      synchronized(TransactionCaptureService.LOCK) {
        val prefs = reactApplicationContext.getSharedPreferences(TransactionCaptureService.PREFS, Context.MODE_PRIVATE)
        val captureActive = prefs.getBoolean(TransactionCaptureService.ACTIVE_KEY, false)
        prefs.edit().putBoolean(TransactionCaptureService.AI_FALLBACK_KEY, enabled && captureActive).apply()
        if (!enabled) TransactionCaptureService.clearAiCandidates(reactApplicationContext)
      }
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("AI_CAPTURE_STATE_FAILED", "Could not update optional AI alert processing.", error)
    }
  }

  @ReactMethod
  fun getPendingAiAlerts(promise: Promise) {
    try {
      val records = TransactionCaptureService.getAiCandidates(reactApplicationContext)
      val result: WritableArray = Arguments.createArray()
      for (index in 0 until records.length()) {
        val item = records.optJSONObject(index) ?: continue
        val map = Arguments.createMap()
        map.putString("id", item.optString("id"))
        map.putString("source", item.optString("source"))
        map.putString("packageName", item.optString("packageName"))
        map.putString("text", item.optString("text"))
        map.putString("date", item.optString("date"))
        result.pushMap(map)
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("AI_ALERT_READ_FAILED", "Could not read encrypted review alerts.", error)
    }
  }

  @ReactMethod
  fun dismissAiAlert(id: String, promise: Promise) {
    try {
      TransactionCaptureService.dismissAiCandidate(reactApplicationContext, id)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("AI_ALERT_REMOVE_FAILED", "Could not clear the processed alert.", error)
    }
  }

  @ReactMethod
  fun getPendingTransactions(promise: Promise) {
    try {
      val records = TransactionCaptureService.readPendingTransactions(reactApplicationContext)
      val result: WritableArray = Arguments.createArray()
      for (index in 0 until records.length()) {
        val item = records.optJSONObject(index) ?: continue
        val map = Arguments.createMap()
        map.putString("id", item.optString("id"))
        map.putDouble("amount", item.optDouble("amount"))
        map.putString("description", item.optString("description"))
        map.putString("category", item.optString("category", "Other"))
        map.putString("transactionType", item.optString("transactionType", "expense"))
        map.putString("packageName", item.optString("packageName"))
        map.putString("date", item.optString("date"))
        result.pushMap(map)
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("CAPTURE_READ_FAILED", "Could not read pending transaction alerts.", error)
    }
  }

  @ReactMethod
  fun getCaptureDiagnostics(promise: Promise) {
    try {
      val prefs = reactApplicationContext.getSharedPreferences(TransactionCaptureService.PREFS, Context.MODE_PRIVATE)
      val last = runCatching { JSONObject(prefs.getString(TransactionCaptureService.LAST_CHECK_KEY, "{}")) }
        .getOrDefault(JSONObject())
      val result = Arguments.createMap()
      result.putBoolean("active", prefs.getBoolean(TransactionCaptureService.ACTIVE_KEY, false))
      result.putInt("checks", prefs.getInt(TransactionCaptureService.CHECK_COUNT_KEY, 0))
      result.putString("lastSource", last.optString("source").takeIf(String::isNotBlank))
      result.putString("lastResult", last.optString("result").takeIf(String::isNotBlank))
      result.putDouble("lastAt", last.optLong("time").toDouble())
      result.putBoolean("amountFound", last.optBoolean("amountFound"))
      result.putBoolean("debitFound", last.optBoolean("debitFound"))
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("CAPTURE_DIAGNOSTICS_FAILED", "Could not read local capture status.", error)
    }
  }

  @ReactMethod
  fun dismissTransaction(id: String, promise: Promise) {
    try {
      TransactionCaptureService.dismissPendingTransaction(reactApplicationContext, id)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("CAPTURE_REMOVE_FAILED", "Could not dismiss the transaction alert.", error)
    }
  }
}
