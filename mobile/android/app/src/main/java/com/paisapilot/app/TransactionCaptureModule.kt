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
  fun setCaptureActive(active: Boolean, promise: Promise) {
    try {
      synchronized(TransactionCaptureService.LOCK) {
        val prefs = reactApplicationContext.getSharedPreferences(TransactionCaptureService.PREFS, Context.MODE_PRIVATE)
        val editor = prefs.edit().putBoolean(TransactionCaptureService.ACTIVE_KEY, active)
        if (!active) editor.putString(TransactionCaptureService.KEY, "[]")
        editor.apply()
      }
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("CAPTURE_STATE_FAILED", "Could not update transaction capture state.", error)
    }
  }

  @ReactMethod
  fun getPendingTransactions(promise: Promise) {
    try {
      val raw = reactApplicationContext.getSharedPreferences(TransactionCaptureService.PREFS, Context.MODE_PRIVATE)
        .getString(TransactionCaptureService.KEY, "[]")
      val records = JSONArray(raw)
      val result: WritableArray = Arguments.createArray()
      for (index in 0 until records.length()) {
        val item = records.optJSONObject(index) ?: continue
        val map = Arguments.createMap()
        map.putString("id", item.optString("id"))
        map.putDouble("amount", item.optDouble("amount"))
        map.putString("description", item.optString("description"))
        map.putString("category", item.optString("category", "Other"))
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
  fun dismissTransaction(id: String, promise: Promise) {
    try {
      synchronized(TransactionCaptureService.LOCK) {
        val prefs = reactApplicationContext.getSharedPreferences(TransactionCaptureService.PREFS, Context.MODE_PRIVATE)
        val records = JSONArray(prefs.getString(TransactionCaptureService.KEY, "[]"))
        val kept = JSONArray()
        for (index in 0 until records.length()) {
          val item = records.optJSONObject(index) ?: continue
          if (item.optString("id") != id) kept.put(item)
        }
        prefs.edit().putString(TransactionCaptureService.KEY, kept.toString()).apply()
      }
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("CAPTURE_REMOVE_FAILED", "Could not dismiss the transaction alert.", error)
    }
  }
}
