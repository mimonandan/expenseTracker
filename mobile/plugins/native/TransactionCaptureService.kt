package com.paisapilot.app

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

class TransactionCaptureService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null || sbn.packageName == packageName || !isCaptureActive()) return
    val extras = sbn.notification.extras ?: return
    val title = extras.getCharSequence("android.title")?.toString()?.trim().orEmpty()
    val text = extras.getCharSequence("android.text")?.toString()?.trim().orEmpty()
    val bigText = extras.getCharSequence("android.bigText")?.toString()?.trim().orEmpty()
    val content = listOf(title, text, bigText).filter { it.isNotBlank() }.distinct().joinToString(" · ")
    if (!looksLikeDebit(content)) return

    val amountMatch = AMOUNT.find(content) ?: return
    val amount = amountMatch.groupValues.drop(1).firstOrNull { it.isNotBlank() }?.replace(",", "")?.toDoubleOrNull() ?: return
    if (amount <= 0) return

    val safeDescription = runCatching {
      packageManager.getApplicationLabel(packageManager.getApplicationInfo(sbn.packageName, 0)).toString()
    }
      .getOrDefault("Payment alert").take(45)
    val record = JSONObject().apply {
      put("id", UUID.randomUUID().toString())
      put("fingerprint", "${sbn.packageName}|${sbn.tag}|${sbn.id}|$amount|${content.hashCode()}")
      put("amount", amount)
      put("description", safeDescription)
      put("category", inferCategory(content))
      put("packageName", sbn.packageName)
      put("date", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).format(Date(sbn.postTime)))
      put("source", "notification")
    }
    synchronized(LOCK) {
      val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
      if (!prefs.getBoolean(ACTIVE_KEY, false)) return
      val records = runCatching { JSONArray(prefs.getString(KEY, "[]")) }.getOrDefault(JSONArray())
      if ((0 until records.length()).any { records.optJSONObject(it)?.optString("fingerprint") == record.optString("fingerprint") }) return
      records.put(record)
      while (records.length() > MAX_RECORDS) records.remove(0)
      prefs.edit().putString(KEY, records.toString()).apply()
    }
  }

  private fun looksLikeDebit(text: String): Boolean {
    if (!AMOUNT.containsMatchIn(text)) return false
    return DEBIT.containsMatchIn(text) && !CREDIT.containsMatchIn(text) && FINANCIAL_CONTEXT.containsMatchIn(text)
  }

  private fun inferCategory(text: String): String = when {
    Regex("grocery|vegetable|veggie|fruit|milk|dairy|kirana|bigbasket|blinkit|zepto|instamart", RegexOption.IGNORE_CASE).containsMatchIn(text) -> "Groceries"
    Regex("pharmacy|chemist|medicine|household|personal care", RegexOption.IGNORE_CASE).containsMatchIn(text) -> "Daily essentials"
    Regex("restaurant|cafe|food|dining|swiggy|zomato|outing", RegexOption.IGNORE_CASE).containsMatchIn(text) -> "Dining & outings"
    Regex("movie|cinema|netflix|spotify|youtube|game|concert", RegexOption.IGNORE_CASE).containsMatchIn(text) -> "Entertainment"
    Regex("uber|ola|metro|fuel|petrol|cab|bus|train|parking", RegexOption.IGNORE_CASE).containsMatchIn(text) -> "Transport"
    Regex("electricity|water bill|internet|broadband|recharge|gas bill", RegexOption.IGNORE_CASE).containsMatchIn(text) -> "Bills & utilities"
    Regex("loan|emi|installment|mortgage", RegexOption.IGNORE_CASE).containsMatchIn(text) -> "Loan & EMI"
    else -> "Other"
  }

  companion object {
    const val PREFS = "paisa_pilot_capture"
    const val KEY = "pending_transactions"
    const val ACTIVE_KEY = "capture_active"
    const val MAX_RECORDS = 100
    val LOCK = Any()
    private val DEBIT = Regex("\\b(debited|spent|purchase|withdrawn|charged|sent|paid|payment of)\\b", RegexOption.IGNORE_CASE)
    private val CREDIT = Regex("\\b(credited|received|refund|cashback)\\b", RegexOption.IGNORE_CASE)
    private val FINANCIAL_CONTEXT = Regex("\\b(upi|card|account|a/c|transaction|txn|bank|payment|purchase|debited|spent)\\b", RegexOption.IGNORE_CASE)
    private val AMOUNT = Regex("(?:INR|Rs\\.?|₹)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*(?:INR|rupees?)", RegexOption.IGNORE_CASE)
  }

  private fun isCaptureActive(): Boolean = getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(ACTIVE_KEY, false)
}
