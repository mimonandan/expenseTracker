package com.paisapilot.app

import android.app.Notification
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class TransactionCaptureService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null || sbn.packageName == packageName || !isCaptureActive()) return
    val extras = sbn.notification.extras ?: run {
      recordNotificationCheck(sbn.packageName, "No readable notification text", false, false)
      return
    }

    val pieces = mutableListOf<String>()
    listOf(
      Notification.EXTRA_TITLE,
      Notification.EXTRA_TITLE_BIG,
      Notification.EXTRA_TEXT,
      Notification.EXTRA_BIG_TEXT,
      Notification.EXTRA_SUB_TEXT,
      Notification.EXTRA_INFO_TEXT,
      Notification.EXTRA_SUMMARY_TEXT,
    ).forEach { key -> extras.getCharSequence(key)?.toString()?.trim()?.takeIf(String::isNotBlank)?.let(pieces::add) }
    extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.forEach { line ->
      line?.toString()?.trim()?.takeIf(String::isNotBlank)?.let(pieces::add)
    }
    // SMS apps commonly use MessagingStyle. Read only the notification's visible message bundles;
    // this does not request or access the device's SMS inbox.
    listOf(Notification.EXTRA_MESSAGES, Notification.EXTRA_HISTORIC_MESSAGES).forEach { key ->
      extras.getParcelableArray(key)?.forEach { parcelable ->
        val message = parcelable as? Bundle ?: return@forEach
        message.getCharSequence("text")?.toString()?.trim()?.takeIf(String::isNotBlank)?.let(pieces::add)
        message.getCharSequence("sender")?.toString()?.trim()?.takeIf(String::isNotBlank)?.let(pieces::add)
      }
    }
    val content = pieces.distinct().joinToString(" · ")
    if (content.isBlank()) {
      recordNotificationCheck(sbn.packageName, "No readable notification text", false, false)
      return
    }

    val sourceLabel = getSourceLabel(sbn.packageName)
    val selectedAmount = selectTransactionAmount(content)
    val amountMatch = selectedAmount?.match
    val amount = selectedAmount?.amount
    val hasCurrencyAmount = AMOUNT.containsMatchIn(content)
    val isTransfer = TRANSFER.containsMatchIn(content)
    val hasCredit = CREDIT.containsMatchIn(content)
    val hasFinancialContext = FINANCIAL_CONTEXT.containsMatchIn(content)
    // This matcher is source-app agnostic: bank alerts, SMS apps, delivery/marketplace,
    // ticketing, shopping, travel, and subscription notifications all use the same cues.
    val hasPurchaseContext = PURCHASE_CONTEXT.containsMatchIn(content)
    val hasDebitEvidence = DEBIT.containsMatchIn(content)
    val hasExplicitDebit = EXPLICIT_DEBIT.containsMatchIn(content)
    val failedOrCancelled = FAILED_OR_CANCELLED.containsMatchIn(content)
    val paymentDueOnly = PAYMENT_DUE.containsMatchIn(content) && !hasExplicitDebit && !hasPurchaseContext
    val promotionOnly = PROMOTION_OR_QUOTE.containsMatchIn(content) && !hasExplicitDebit && !hasPurchaseContext
    val hasCostCue = COST_CUE.containsMatchIn(content)
    val hasSpendAction = hasDebitEvidence || hasPurchaseContext
    val hasNonSpendLanguage = NON_SPEND.containsMatchIn(content)
    val confirmedSpend = hasSpendAction && (hasFinancialContext || hasPurchaseContext || hasCostCue)
    val confirmedTransfer = isTransfer && (hasExplicitDebit || hasPurchaseContext)
    val result = when {
      failedOrCancelled -> "Failed/cancelled transaction ignored"
      hasCredit && !hasSpendAction -> "Credit/refund ignored"
      amountMatch == null -> "No currency amount found"
      amount == null || amount <= 0 -> "Amount could not be read"
      paymentDueOnly -> "Payment request or amount due ignored"
      promotionOnly -> "Offer or price quote ignored"
      hasNonSpendLanguage && !hasSpendAction -> "Estimate/offer ignored"
      isTransfer && confirmedTransfer -> "Matched transfer alert"
      isTransfer -> "Unconfirmed transfer ignored"
      confirmedSpend -> "Matched spend alert"
      !hasSpendAction -> "No spending or cost wording found"
      else -> "No payment or purchase context found"
    }
    val matched = result == "Matched spend alert" || result == "Matched transfer alert"
    recordNotificationCheck(sbn.packageName, result, hasCurrencyAmount, hasSpendAction)
    if (!matched) {
      val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
      if (prefs.getBoolean(AI_FALLBACK_KEY, false) && hasCurrencyAmount && !hasCredit && !isTransfer && !paymentDueOnly && !promotionOnly && !failedOrCancelled && AI_CANDIDATE_SIGNAL.containsMatchIn(content)) {
        enqueueAiCandidate(this, sbn, sourceLabel, content)
      }
      return
    }
    val safeAmount = amount ?: return

    val safeDescription = inferMerchant(content, sourceLabel, sbn.packageName)
      ?: if (sourceLabel.equals("Gmail", ignoreCase = true)) "Bank / UPI alert" else sourceLabel.ifBlank { "Payment alert" }.take(45)
    val record = JSONObject().apply {
      put("id", UUID.randomUUID().toString())
      put("fingerprint", notificationFingerprint(sbn.packageName, safeAmount, content, sbn.postTime))
      put("amount", safeAmount)
      put("description", safeDescription)
      put("category", inferCategory(content, sourceLabel, sbn.packageName))
      put("transactionType", if (isTransfer) "transfer" else "expense")
      put("packageName", sbn.packageName)
      put("date", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(Date(sbn.postTime)))
      put("source", "notification")
    }
    synchronized(LOCK) {
      val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
      if (!prefs.getBoolean(ACTIVE_KEY, false)) return
      val records = runCatching { readPendingTransactions(this) }.getOrElse {
        recordNotificationCheck(sbn.packageName, "Protected local alert queue could not be opened", false, false)
        return
      }
      if ((0 until records.length()).any { records.optJSONObject(it)?.optString("fingerprint") == record.optString("fingerprint") }) return
      records.put(record)
      while (records.length() > MAX_RECORDS) records.remove(0)
      prefs.edit().putString(KEY, encryptLocalData(records.toString())).apply()
    }
  }

  private fun getSourceLabel(packageName: String): String = runCatching {
    packageManager.getApplicationLabel(packageManager.getApplicationInfo(packageName, 0)).toString()
  }.getOrDefault("Payment alert").take(45)

  private fun recordNotificationCheck(packageName: String, result: String, amountFound: Boolean, debitFound: Boolean) {
    val sourceLabel = getSourceLabel(packageName)
    synchronized(LOCK) {
      val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
      val check = JSONObject().apply {
        put("source", sourceLabel)
        put("result", result)
        put("amountFound", amountFound)
        put("debitFound", debitFound)
        put("time", System.currentTimeMillis())
      }
      prefs.edit()
        .putInt(CHECK_COUNT_KEY, prefs.getInt(CHECK_COUNT_KEY, 0) + 1)
        .putString(LAST_CHECK_KEY, check.toString())
        .apply()
    }
  }

  private fun inferCategory(text: String, source: String, packageName: String): String {
    val all = "$source $packageName $text"
    return when {
      Regex("cult\\s*\\.?\\s*fit|cultfit|gym|fitness|workout|wellness|yoga|health club", RegexOption.IGNORE_CASE).containsMatchIn(all) -> "Health & fitness"
      Regex("\\b(grocery|groceries|vegetable|veggie|fruit|milk|dairy|kirana|bigbasket|blinkit|zepto|instamart|grofers)\\b", RegexOption.IGNORE_CASE).containsMatchIn(all) -> "Groceries"
      Regex("\\b(pharmacy|chemist|medicine|household|personal care|toiletries|apollo pharmacy|1mg|pharmeasy)\\b", RegexOption.IGNORE_CASE).containsMatchIn(all) -> "Daily essentials"
      Regex("\\b(restaurant|cafe|food|dining|swiggy|zomato|outing|bar|pizza|dine.?out)\\b", RegexOption.IGNORE_CASE).containsMatchIn(all) -> "Dining & outings"
      Regex("\\b(rapido|uber|ola|in.?drive|nammayatri|bike taxi|metro|fuel|petrol|cab|bus|train|parking|ride fare)\\b", RegexOption.IGNORE_CASE).containsMatchIn(all) -> "Transport"
      Regex("\\b(movie|cinema|netflix|hotstar|jiohotstar|spotify|prime video|youtube premium|game|concert|book\\s?my\\s?show|district|event ticket)\\b", RegexOption.IGNORE_CASE).containsMatchIn(all) -> "Entertainment"
      Regex("\\b(myntra|fashion|clothing|shopping|flipkart)\\b", RegexOption.IGNORE_CASE).containsMatchIn(all) -> "Shopping"
      Regex("electricity|water bill|internet|broadband|recharge|gas bill|utility bill", RegexOption.IGNORE_CASE).containsMatchIn(all) -> "Bills & utilities"
      Regex("credit card (?:bill|payment)|card bill payment|loan|emi|installment|mortgage|repayment", RegexOption.IGNORE_CASE).containsMatchIn(all) -> "Loan & EMI"
      else -> "Other"
    }
  }

  private fun inferMerchant(text: String, source: String, packageName: String): String? {
    val all = "$text $source $packageName"
    val merchants = listOf(
      "cult.fit" to "Cult.fit", "cultfit" to "Cult.fit", "rapido" to "Rapido", "uber" to "Uber", "ola" to "Ola",
      "zepto" to "Zepto", "blinkit" to "Blinkit", "instamart" to "Instamart", "bigbasket" to "BigBasket",
      "zomato" to "Zomato", "swiggy" to "Swiggy", "myntra" to "Myntra", "bookmyshow" to "BookMyShow",
      "district" to "District", "netflix" to "Netflix", "spotify" to "Spotify", "youtube premium" to "YouTube Premium",
      "hotstar" to "JioHotstar", "amazon" to "Amazon", "flipkart" to "Flipkart", "jio" to "Jio",
    )
    return merchants.firstOrNull { (token, _) -> Regex("\\b${Regex.escape(token)}\\b", RegexOption.IGNORE_CASE).containsMatchIn(all) }?.second
  }

  companion object {
    const val PREFS = "paisa_pilot_capture"
    const val KEY = "pending_transactions"
    const val ACTIVE_KEY = "capture_active"
    const val CHECK_COUNT_KEY = "notification_check_count"
    const val LAST_CHECK_KEY = "last_notification_check"
    const val MAX_RECORDS = 100
    const val AI_FALLBACK_KEY = "ai_fallback_enabled"
    private const val AI_QUEUE_KEY = "encrypted_ai_alert_queue"
    private const val AI_KEY_ALIAS = "paisa_pilot_ai_alert_queue_v1"
    private const val LOCAL_DATA_KEY_ALIAS = "paisa_pilot_local_data_v1"
    val LOCK = Any()
    private val DEBIT = Regex("\\b(debited|deducted|spent|withdrawn|was charged|has been charged|charged to your|charged successfully|sent to|paid to|paid for|was paid|paid successfully|you paid|payment made|payment of|payment successful|payment completed|amount paid|amount debited|transaction successful|purchase successful)\\b", RegexOption.IGNORE_CASE)
    private val EXPLICIT_DEBIT = Regex("\\b(debited|deducted|spent|withdrawn|was charged|has been charged|charged to your|charged successfully|sent to|paid to|paid for|was paid|paid successfully|you paid|payment made|payment successful|payment completed|amount paid|amount debited|transaction successful|purchase successful)\\b", RegexOption.IGNORE_CASE)
    private val PAYMENT_DUE = Regex("\\b(payment due|amount due|due date|pay by|payable|please pay|outstanding balance|payment request|pay now|payment pending)\\b", RegexOption.IGNORE_CASE)
    private val FAILED_OR_CANCELLED = Regex("\\b(failed|declined|unsuccessful|not completed|not successful|could not be completed|couldn't be completed|unable to process|cancelled|canceled|reversal pending|will be reversed)\\b", RegexOption.IGNORE_CASE)
    private val CREDIT = Regex("\\b(credited|received|refund|cashback|reversed|money back)\\b", RegexOption.IGNORE_CASE)
    private val TRANSFER = Regex("\\b(credit card (?:bill|payment)|card bill payment|wallet (?:top.?up|load)|add(?:ed)? money to (?:wallet|account)|self transfer|own account transfer|account transfer|fund transfer|balance top.?up)\\b", RegexOption.IGNORE_CASE)
    private val FINANCIAL_CONTEXT = Regex("\\b(upi|card|account|a/c|transaction|txn|bank|payment|purchase|debited|spent|charged|paid)\\b", RegexOption.IGNORE_CASE)
    private val PURCHASE_CONTEXT = Regex("\\b(order successful|order completed|order delivered|booking confirmed|ticket booked|subscription renewed|auto.?renewed|purchase confirmed|purchase completed|payment successful|payment completed|transfer successful|top.?up successful|receipt|invoice paid|bill paid|recharge successful|ride completed|trip completed|journey completed|service completed)\\b", RegexOption.IGNORE_CASE)
    private val COST_CUE = Regex("\\b(cost|price|fare|total|amount payable|payable|to be paid|you owe)\\b", RegexOption.IGNORE_CASE)
    private val NON_SPEND = Regex("\\b(estimate|estimated|approx|starting at|from ₹|offer|coupon|discount|promo|cancelled|canceled|refund|cashback|money back|free trial)\\b", RegexOption.IGNORE_CASE)
    private val PROMOTION_OR_QUOTE = Regex("\\b(offer|special offer|coupon|discount|promo(?:tion)?|deal|save up to|worth|starting at|starts at|estimated?|estimate|quote|price quote|fare estimate|cart total|add to cart|book now)\\b", RegexOption.IGNORE_CASE)
    private val AMOUNT = Regex("(?:INR|Rs\\.?|₹)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*(?:INR|rupees?)", RegexOption.IGNORE_CASE)
    private val POSITIVE_AMOUNT_CONTEXT = Regex("\\b(debited|deducted|spent|withdrawn|charged|paid|payment of|payment completed|amount paid|amount debited|transaction amount|total paid|total charged|invoice total|order total|grand total|final fare|actual fare|price paid|purchase successful|transaction successful|payment successful|transfer successful|top.?up successful|order delivered|booking confirmed|ticket booked|subscription renewed|bill paid|recharge successful|ride completed|trip completed|service completed)\\b", RegexOption.IGNORE_CASE)
    private val NEGATIVE_AMOUNT_CONTEXT = Regex("\\b(available balance|current balance|closing balance|remaining balance|balance|amount due|payment due|outstanding|payable|due date|cashback|refund|reversed|credited|reward|offer|discount|coupon|mrp|list price|worth|savings?)\\b", RegexOption.IGNORE_CASE)
    private data class SelectedAmount(val match: MatchResult, val amount: Double, val positiveDistance: Int, val negativeDistance: Int)

    private fun cueDistance(text: String, candidate: MatchResult, pattern: Regex, allAmounts: List<MatchResult>): Int {
      val start = candidate.range.first
      val end = candidate.range.last + 1
      var closest = Int.MAX_VALUE
      pattern.findAll(text).forEach { cue ->
        val cueEnd = cue.range.last + 1
        val distance = when {
          cueEnd < start -> start - cueEnd
          cue.range.first > end -> cue.range.first - end
          else -> 0
        }
        val closerAmountExists = allAmounts.any { other ->
          if (other === candidate) false else {
            val otherStart = other.range.first
            val otherEnd = other.range.last + 1
            val otherDistance = when {
              cueEnd < otherStart -> otherStart - cueEnd
              cue.range.first > otherEnd -> cue.range.first - otherEnd
              else -> 0
            }
            otherDistance < distance
          }
        }
        if (!closerAmountExists && distance < closest) closest = distance
      }
      return closest
    }

    private fun selectTransactionAmount(text: String): SelectedAmount? {
      val allMatches = AMOUNT.findAll(text).toList()
      val ranked = allMatches.mapNotNull { match ->
        val amount = match.groupValues.drop(1).firstOrNull { it.isNotBlank() }?.replace(",", "")?.toDoubleOrNull() ?: return@mapNotNull null
        val positiveDistance = cueDistance(text, match, POSITIVE_AMOUNT_CONTEXT, allMatches)
        val negativeDistance = cueDistance(text, match, NEGATIVE_AMOUNT_CONTEXT, allMatches)
        if (amount <= 0 || positiveDistance > 58 || (negativeDistance != Int.MAX_VALUE && positiveDistance + 12 >= negativeDistance)) return@mapNotNull null
        SelectedAmount(match, amount, positiveDistance, negativeDistance)
      }.sortedWith(compareBy<SelectedAmount> { it.positiveDistance }.thenBy { it.negativeDistance })
      if (ranked.isEmpty()) return null
      if (ranked.size > 1 && ranked[0].amount != ranked[1].amount && ranked[1].positiveDistance - ranked[0].positiveDistance < 12) return null
      return ranked.first()
    }
    private val AI_CANDIDATE_SIGNAL = Regex("\\b(debit|debited|spend|spent|paid|payment|transaction|purchase|order|booking|ticket|subscription|recharge|cost|price|fare|total|payable|charged|bill|emi)\\b", RegexOption.IGNORE_CASE)

    private fun notificationFingerprint(packageName: String, amount: Double, content: String, postTime: Long): String {
      val stableText = content.lowercase(Locale.ROOT)
        .replace(Regex("\\b(?:account|a/c|card|ref(?:erence)?|utr|txn|transaction)\\s*(?:no|number|#|id)?[ .:#-]*[a-z0-9-]{5,}\\b", RegexOption.IGNORE_CASE), " ")
        .replace(Regex("\\b\\d{1,2}[:.]\\d{2}(?::\\d{2})?\\b"), " ")
        .replace(Regex("\\s+"), " ").trim()
      return "$packageName|${amount.toLong()}|${stableText.hashCode()}|${postTime / 60_000}"
    }

    fun getAiCandidates(context: Context): JSONArray = synchronized(LOCK) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      if (!prefs.getBoolean(AI_FALLBACK_KEY, false)) return@synchronized JSONArray()
      val encrypted = prefs.getString(AI_QUEUE_KEY, null) ?: return@synchronized JSONArray()
      runCatching { JSONArray(decrypt(encrypted)) }.getOrElse {
        prefs.edit().remove(AI_QUEUE_KEY).apply()
        JSONArray()
      }
    }

    fun dismissAiCandidate(context: Context, id: String) = synchronized(LOCK) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val current = getAiCandidates(context)
      val remaining = JSONArray()
      for (index in 0 until current.length()) {
        val item = current.optJSONObject(index) ?: continue
        if (item.optString("id") != id) remaining.put(item)
      }
      if (remaining.length() == 0) prefs.edit().remove(AI_QUEUE_KEY).apply()
      else prefs.edit().putString(AI_QUEUE_KEY, encrypt(remaining.toString())).apply()
    }

    fun clearAiCandidates(context: Context) = synchronized(LOCK) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .remove(AI_QUEUE_KEY).putBoolean(AI_FALLBACK_KEY, false).apply()
    }

    private fun enqueueAiCandidate(context: Context, sbn: StatusBarNotification, source: String, content: String) = synchronized(LOCK) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      if (!prefs.getBoolean(AI_FALLBACK_KEY, false)) return@synchronized
      val amount = selectTransactionAmount(content)?.amount ?: 0.0
      val id = "ai-${sbn.packageName}-${notificationFingerprint(sbn.packageName, amount, content, sbn.postTime)}"
      val queue = getAiCandidates(context)
      if ((0 until queue.length()).any { queue.optJSONObject(it)?.optString("id") == id }) return@synchronized
      val item = JSONObject().apply {
        put("id", id)
        put("source", source.take(60))
        put("packageName", sbn.packageName.take(120))
        put("text", redactNotification(content).take(1200))
        put("date", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(Date(sbn.postTime)))
      }
      queue.put(item)
      while (queue.length() > 20) queue.remove(0)
      prefs.edit().putString(AI_QUEUE_KEY, encrypt(queue.toString())).apply()
    }

    private fun redactNotification(value: String): String = value
      .replace(Regex("[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", RegexOption.IGNORE_CASE), "[email]")
      .replace(Regex("(?<!\\w)[A-Z0-9._%+-]+@[A-Z0-9.-]+(?!\\w)", RegexOption.IGNORE_CASE), "[upi-id]")
      .replace(Regex("(?<!\\d)(?:\\+?91[ -]?)?[6-9]\\d{9}(?!\\d)"), "[phone]")
      .replace(Regex("\\b[A-Z]{5}\\d{4}[A-Z]\\b", RegexOption.IGNORE_CASE), "[pan]")
      .replace(Regex("\\b(?:account|a/c|card|ref(?:erence)?|utr|txn|transaction)\\s*(?:no|number|#|id)?[ .:#-]*[A-Z0-9-]{5,}\\b", RegexOption.IGNORE_CASE), "[private-id]")
      .replace(Regex("(?<!\\d)\\d{12,19}(?!\\d)"), "[number]")

    fun encryptLocalData(value: String): String = "enc:v1:" + encrypt(value, LOCAL_DATA_KEY_ALIAS)

    fun decryptLocalData(value: String): String {
      require(value.startsWith("enc:v1:")) { "Unsupported local data format" }
      return decrypt(value.removePrefix("enc:v1:"), LOCAL_DATA_KEY_ALIAS)
    }

    fun readPendingTransactions(context: Context): JSONArray = synchronized(LOCK) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val saved = prefs.getString(KEY, null) ?: return@synchronized JSONArray()
      if (saved.startsWith("enc:v1:")) JSONArray(decryptLocalData(saved))
      else JSONArray(saved).also { prefs.edit().putString(KEY, encryptLocalData(it.toString())).apply() }
    }

    fun clearPendingTransactions(context: Context) = synchronized(LOCK) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString(KEY, encryptLocalData("[]")).apply()
    }

    fun dismissPendingTransaction(context: Context, id: String) = synchronized(LOCK) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val kept = JSONArray()
      val records = readPendingTransactions(context)
      for (index in 0 until records.length()) {
        val item = records.optJSONObject(index) ?: continue
        if (item.optString("id") != id) kept.put(item)
      }
      prefs.edit().putString(KEY, encryptLocalData(kept.toString())).apply()
    }

    private fun secretKey(alias: String = AI_KEY_ALIAS): SecretKey {
      val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
      val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
      generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build())
      return generator.generateKey()
    }

    private fun encrypt(value: String, alias: String = AI_KEY_ALIAS): String {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, secretKey(alias))
      val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
      val payload = cipher.iv + ciphertext
      return Base64.encodeToString(payload, Base64.NO_WRAP)
    }

    private fun decrypt(value: String, alias: String = AI_KEY_ALIAS): String {
      val payload = Base64.decode(value, Base64.NO_WRAP)
      require(payload.size > 12) { "Invalid encrypted alert queue" }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, secretKey(alias), GCMParameterSpec(128, payload.copyOfRange(0, 12)))
      return String(cipher.doFinal(payload.copyOfRange(12, payload.size)), Charsets.UTF_8)
    }
  }

  private fun isCaptureActive(): Boolean = getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(ACTIVE_KEY, false)
}
