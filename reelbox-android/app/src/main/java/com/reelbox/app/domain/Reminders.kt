package com.reelbox.app.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Runs a reminder at a given time. The real one uses WorkManager; tests use a fake. */
interface ReminderScheduler {
    fun schedule(reelId: Long, atMillis: Long)
    fun cancel(reelId: Long)
}

object NoScheduler : ReminderScheduler {
    override fun schedule(reelId: Long, atMillis: Long) = Unit
    override fun cancel(reelId: Long) = Unit
}

/** When to notify: 09:00 on the day before the event. If that moment has passed but the event hasn't, soon. */
object ReminderPlanner {
    const val HOUR = 9

    /** @return when to remind, or null if the event is already in the past. */
    fun remindAt(event: LocalDate, nowMillis: Long, zone: ZoneId): Long? {
        val today = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()
        if (event.isBefore(today)) return null
        val dayBefore = event.minusDays(1).atTime(HOUR, 0).atZone(zone).toInstant().toEpochMilli()
        return if (dayBefore > nowMillis) dayBefore else nowMillis + 60_000
    }
}
