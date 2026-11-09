package com.galsever.school.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.galsever.school.App
import com.galsever.school.R
import com.galsever.school.net.ApiException
import com.galsever.school.ui.MainActivity
import com.galsever.school.ui.Routes
import com.galsever.school.ui.screens.isOpen
import java.util.concurrent.TimeUnit

/**
 * The background check: every 15 minutes (Android's shortest period) it asks the hub for unread chats, new
 * assignments and new inbox mail and notifies about what it has not seen before. The first run after install only
 * remembers what is there. No push service: the phone reaches the hub only over Tailscale.
 */
object Checker {
    val KINDS = listOf("chats" to "Chat messages", "assignments" to "New assignments", "mail" to "Mail")
    private const val WORK = "check"
    private const val PREFS = "checker"

    /** True while the app is on screen: then nothing is notified (the app shows it), only remembered. */
    @Volatile var visible = false

    fun setup(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        KINDS.forEach { (id, label) -> nm.createNotificationChannel(NotificationChannel(id, label, NotificationManager.IMPORTANCE_DEFAULT)) }
        nm.createNotificationChannel(NotificationChannel("account", "Sign-in", NotificationManager.IMPORTANCE_LOW))
        val req = PeriodicWorkRequestBuilder<CheckWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    fun kinds(ctx: Context): Set<String> =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet("kinds", null) ?: KINDS.map { it.first }.toSet()

    fun setKinds(ctx: Context, kinds: Set<String>) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet("kinds", kinds).apply()
    }

    internal fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

class CheckWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    private val prefs = Checker.prefs(ctx)

    override suspend fun doWork(): Result {
        val app = App.instance
        if (!app.session.loggedIn) return Result.success()
        val kinds = Checker.kinds(applicationContext)
        try {
            chats(kinds)
            assignments(kinds)
            mail(kinds)
            prefs.edit().remove("signin-told").apply()
        } catch (e: ApiException) {
            if (e.code == "gate_login" && !prefs.getBoolean("signin-told", false)) {
                prefs.edit().putBoolean("signin-told", true).apply()
                notify("account", 1, "School", "Sign in again to get notifications", Routes.CHATS)
            }
        }
        return Result.success()
    }

    /** Unread chats whose newest message (not mine) is newer than what was last seen for that chat. */
    private suspend fun chats(kinds: Set<String>) {
        val list = App.instance.api.chats()
        val first = !prefs.contains("chats-seen")
        val seen = prefs.getStringSet("chats-seen", emptySet())!!.associate { it.substringBefore('|') to it.substringAfter('|') }.toMutableMap()
        for (c in list) {
            val last = c.last ?: continue
            val before = seen[c.id]
            seen[c.id] = last.time
            if (first || !c.unread || last.mine || before == last.time || (before != null && before > last.time)) continue
            if ("chats" in kinds && !Checker.visible) {
                val who = if (c.kind == "chat" && !c.title.contains(",")) "" else last.from.substringBefore(" ") + ": "
                notify("chats", c.id.hashCode(), c.title, who + last.text, Routes.chat(c.id))
            }
        }
        prefs.edit().putStringSet("chats-seen", seen.entries.take(400).map { "${it.key}|${it.value}" }.toSet()).apply()
    }

    private suspend fun assignments(kinds: Set<String>) {
        val list = App.instance.api.assignments()
        val first = !prefs.contains("assignments-seen")
        val seen = prefs.getStringSet("assignments-seen", emptySet())!!
        for (a in list) {
            if (first || a.id in seen || !isOpen(a)) continue
            if ("assignments" in kinds && !Checker.visible) notify("assignments", a.id.hashCode(), a.title, a.className, Routes.assignment(a.classId, a.id))
        }
        prefs.edit().putStringSet("assignments-seen", list.map { it.id }.toSet()).apply()
    }

    private suspend fun mail(kinds: Set<String>) {
        val page = App.instance.api.mailList("inbox", "", unread = true)
        val first = !prefs.contains("mail-seen")
        val seen = prefs.getStringSet("mail-seen", emptySet())!!
        for (m in page.messages) {
            if (first || m.id in seen) continue
            if ("mail" in kinds && !Checker.visible) notify("mail", m.id.hashCode(), m.from.name.ifBlank { m.from.address }, m.subject, Routes.mail(m.id))
        }
        prefs.edit().putStringSet("mail-seen", (page.messages.map { it.id } + seen).take(300).toSet()).apply()
    }

    private fun notify(channel: String, id: Int, title: String, text: String, route: String) {
        val ctx = applicationContext
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val open = PendingIntent.getActivity(
            ctx,
            id,
            Intent(ctx, MainActivity::class.java).putExtra(MainActivity.EXTRA_ROUTE, route).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setGroup(channel)
            .build()
        NotificationManagerCompat.from(ctx).notify(channel, id, n)
    }
}
