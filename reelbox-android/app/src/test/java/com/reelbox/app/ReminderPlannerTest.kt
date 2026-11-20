package com.reelbox.app

import com.reelbox.app.domain.ReminderPlanner
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

class ReminderPlannerTest {
    private val zone = ZoneId.of("Europe/Amsterdam")
    private fun millis(date: LocalDate, hour: Int, minute: Int = 0) = LocalDateTime.of(date, LocalTime.of(hour, minute)).atZone(zone).toInstant().toEpochMilli()
    private val day = LocalDate.of(2026, 11, 20)

    @Test fun nineInTheMorningTheDayBefore() =
        assertEquals(millis(LocalDate.of(2026, 12, 24), 9), ReminderPlanner.remindAt(LocalDate.of(2026, 12, 25), millis(day, 12), zone))

    @Test fun tomorrowBeforeNineStillWaitsForNine() =
        assertEquals(millis(day, 9), ReminderPlanner.remindAt(day.plusDays(1), millis(day, 8), zone))

    @Test fun tomorrowAfterNineRemindsAlmostImmediately() {
        val now = millis(day, 10)
        assertEquals(now + 60_000, ReminderPlanner.remindAt(day.plusDays(1), now, zone))
    }

    @Test fun todayRemindsAlmostImmediately() {
        val now = millis(day, 10)
        assertEquals(now + 60_000, ReminderPlanner.remindAt(day, now, zone))
    }

    @Test fun aPastDateGetsNoReminder() = assertNull(ReminderPlanner.remindAt(day.minusDays(1), millis(day, 10), zone))

    @Test fun staysAtNineLocalTimeAcrossDaylightSaving() {
        val r = ReminderPlanner.remindAt(LocalDate.of(2027, 3, 29), millis(day, 12), zone)!!   // clocks go forward on 28 March 2027
        assertEquals(LocalTime.of(9, 0), java.time.Instant.ofEpochMilli(r).atZone(zone).toLocalTime())
        assertEquals(LocalDate.of(2027, 3, 28), java.time.Instant.ofEpochMilli(r).atZone(zone).toLocalDate())
    }
}
