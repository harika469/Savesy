package com.reelbox.app

import android.Manifest
import android.annotation.SuppressLint
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
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.reelbox.app.data.ReelEntity
import com.reelbox.app.domain.ReminderScheduler
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit

/** One WorkManager job per reel. It survives restarts and reboots; timing is approximate (it can be a few minutes late). */
class WorkReminderScheduler(private val context: Context) : ReminderScheduler {
    override fun schedule(reelId: Long, atMillis: Long) {
        val delay = (atMillis - System.currentTimeMillis()).coerceAtLeast(0)
        val request = OneTimeWorkRequestBuilder<ReminderWorker>()
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setInputData(workDataOf(ReminderWorker.KEY_REEL_ID to reelId))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(workName(reelId), ExistingWorkPolicy.REPLACE, request)
    }

    override fun cancel(reelId: Long) {
        WorkManager.getInstance(context).cancelUniqueWork(workName(reelId))
    }

    companion object { fun workName(reelId: Long) = "reminder-$reelId" }
}

class ReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val id = inputData.getLong(KEY_REEL_ID, -1)
        val app = applicationContext as? ReelboxApp ?: return Result.success()
        val reel = app.repository.observeReelOnce(id) ?: return Result.success()
        val event = reel.eventDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        // Removed or changed since this job was queued: nothing to say.
        if (reel.remindAt == null || event == null) return Result.success()
        Notifications.showReminder(applicationContext, reel, event)
        app.repository.markReminderSent(id)
        return Result.success()
    }

    companion object { const val KEY_REEL_ID = "reel_id" }
}

object Notifications {
    const val CHANNEL = "reminders"
    const val EXTRA_REEL_ID = "reel_id"

    fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun title(reel: ReelEntity, event: LocalDate, today: LocalDate): String {
        val whenText = when (ChronoUnit.DAYS.between(today, event)) {
            0L -> "Today"
            1L -> "Tomorrow"
            else -> "On " + event.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
        }
        return "$whenText: ${reel.title}"
    }

    /** @return false when notifications are switched off, in which case nothing is shown. */
    @SuppressLint("MissingPermission")
    fun showReminder(context: Context, reel: ReelEntity, event: LocalDate, today: LocalDate = LocalDate.now()): Boolean {
        if (!canNotify(context)) return false
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Reel reminders", NotificationManager.IMPORTANCE_DEFAULT))
        }
        val open = PendingIntent.getActivity(
            context, reel.id.toInt(),
            Intent(context, MainActivity::class.java).putExtra(EXTRA_REEL_ID, reel.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title(reel, event, today))
            .setContentText("${reel.creatorHandle ?: reel.platform.label} \u2022 tap to open the reel")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(reel.id.toInt(), notification)
        return true
    }
}
