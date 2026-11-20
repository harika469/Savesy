package com.reelbox.app

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.reelbox.app.data.AppDatabase
import com.reelbox.app.data.CaptureResult
import com.reelbox.app.data.ReelRepository
import com.reelbox.app.domain.ManualProvider
import com.reelbox.app.domain.ReminderScheduler
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

private class FakeScheduler : ReminderScheduler {
    val scheduled = mutableMapOf<Long, Long>()
    val cancelled = mutableListOf<Long>()
    override fun schedule(reelId: Long, atMillis: Long) { scheduled[reelId] = atMillis }
    override fun cancel(reelId: Long) { scheduled.remove(reelId); cancelled += reelId }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReelRepositoryReminderTest {
    private val zone = ZoneId.of("Europe/Amsterdam")
    private val today = LocalDate.of(2026, 11, 20)
    private val now = LocalDateTime.of(today, LocalTime.NOON).atZone(zone).toInstant().toEpochMilli()
    private fun at(date: LocalDate, hour: Int) = LocalDateTime.of(date, LocalTime.of(hour, 0)).atZone(zone).toInstant().toEpochMilli()

    private lateinit var db: AppDatabase
    private lateinit var scheduler: FakeScheduler
    private lateinit var repo: ReelRepository

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java).allowMainThreadQueries().build()
        scheduler = FakeScheduler()
        repo = ReelRepository(db, ManualProvider, now = { now }, scheduler = scheduler, zone = zone)
    }

    @After fun tearDown() = db.close()

    private suspend fun reel(caption: String? = null): Long {
        val saved = repo.capture("https://www.instagram.com/reel/DeG_FtSJmIR/") as CaptureResult.Saved
        if (caption != null) repo.setCaptionFromText(saved.reel.id, caption)
        return saved.reel.id
    }

    private suspend fun load(id: Long) = repo.observeReel(id).first()!!

    @Test fun aDateInTheCaptionSetsAReminderForNineTheDayBefore() = runBlocking {
        val id = reel("Christmas market with mulled wine. Ends 25 December, don't miss it")
        repo.organiseWithAi(id)
        val r = load(id)
        assertEquals("2026-12-25", r.eventDate)
        assertEquals(at(LocalDate.of(2026, 12, 24), 9), r.remindAt)
        assertEquals(r.remindAt, scheduler.scheduled[id])
    }

    @Test fun aShortCaptionStillGetsItsDateEvenThoughTheAiIsSkipped() = runBlocking {
        val id = reel("Ends 25 Dec")
        assertEquals(com.reelbox.app.data.OrganiseOutcome.TooLittleText, repo.organiseWithAi(id))
        assertEquals("2026-12-25", load(id).eventDate)
    }

    @Test fun noDateMeansNoReminder() = runBlocking {
        val id = reel("Easy tomato soup with basil in 15 minutes, serves 4")
        repo.organiseWithAi(id)
        assertNull(load(id).eventDate); assertNull(load(id).remindAt); assertTrue(scheduler.scheduled.isEmpty())
    }

    @Test fun aDateTheUserChoseIsNeverReplacedByADetectedOne() = runBlocking {
        val id = reel("Ends 25 December, don't miss out on the fun")
        repo.setEventDate(id, LocalDate.of(2026, 12, 31))
        repo.organiseWithAi(id)
        assertEquals("2026-12-31", load(id).eventDate)
    }

    @Test fun aRemovedReminderIsNotBroughtBack() = runBlocking {
        val id = reel("Ends 25 December, don't miss out on the fun")
        repo.organiseWithAi(id)
        assertNotNull(load(id).remindAt)
        repo.setEventDate(id, null)
        repo.setCaptionFromText(id, "Ends 25 December, still the same caption here")
        repo.organiseWithAi(id)
        val r = load(id)
        assertNull(r.eventDate); assertNull(r.remindAt)
        assertTrue(id in scheduler.cancelled); assertTrue(scheduler.scheduled.isEmpty())
    }

    @Test fun aPastDateGivesNoReminder() = runBlocking {
        val id = reel()
        repo.setEventDate(id, today.minusDays(1))
        assertNull(load(id).remindAt)
        assertTrue(scheduler.scheduled.isEmpty())
    }

    @Test fun anEventTomorrowRemindsSoonBecauseNineAmHasPassed() = runBlocking {
        val id = reel()
        repo.setEventDate(id, today.plusDays(1))
        assertEquals(now + 60_000, load(id).remindAt)
    }

    @Test fun changingTheDateReplacesTheScheduledReminder() = runBlocking {
        val id = reel()
        repo.setEventDate(id, LocalDate.of(2026, 12, 25))
        repo.setEventDate(id, LocalDate.of(2027, 1, 10))
        assertEquals(at(LocalDate.of(2027, 1, 9), 9), scheduler.scheduled[id])
        assertEquals(1, scheduler.scheduled.size)
    }

    @Test fun deletingTheReelCancelsItsReminder() = runBlocking {
        val id = reel()
        repo.setEventDate(id, LocalDate.of(2026, 12, 25))
        repo.delete(id)
        assertTrue(scheduler.scheduled.isEmpty())
    }

    @Test fun aSentReminderClearsTheReminderButKeepsTheDate() = runBlocking {
        val id = reel()
        repo.setEventDate(id, LocalDate.of(2026, 12, 25))
        repo.markReminderSent(id)
        val r = load(id)
        assertNull(r.remindAt); assertEquals("2026-12-25", r.eventDate)
    }

    @Test fun afterARestartOnlyPendingRemindersAreScheduledAgain() = runBlocking {
        val withReminder = reel()
        repo.setEventDate(withReminder, LocalDate.of(2026, 12, 25))
        scheduler.scheduled.clear()
        val saved = repo.capture("https://www.instagram.com/reel/OTHER2/") as CaptureResult.Saved
        repo.rescheduleReminders()
        assertEquals(setOf(withReminder), scheduler.scheduled.keys)
        assertTrue(saved.reel.id !in scheduler.scheduled)
    }
}
