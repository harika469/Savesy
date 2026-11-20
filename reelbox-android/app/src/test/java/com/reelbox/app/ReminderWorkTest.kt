package com.reelbox.app

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import androidx.work.workDataOf
import com.reelbox.app.data.CaptureResult
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReminderWorkTest {
    private lateinit var context: Context
    private lateinit var app: ReelboxApp

    @Before fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        app = context as ReelboxApp
    }

    private fun states(reelId: Long) =
        WorkManager.getInstance(context).getWorkInfosForUniqueWork(WorkReminderScheduler.workName(reelId)).get().map { it.state }

    private fun notifications() = shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications

    private suspend fun reelWithDate(date: LocalDate?): Long {
        val saved = app.repository.capture("https://www.instagram.com/reel/DeG_FtSJmIR/") as CaptureResult.Saved
        app.repository.setCaptionFromText(saved.reel.id, "Christmas market in town")
        if (date != null) app.repository.setEventDate(saved.reel.id, date)
        return saved.reel.id
    }

    private suspend fun runWorker(id: Long) =
        TestListenableWorkerBuilder<ReminderWorker>(context).setInputData(workDataOf(ReminderWorker.KEY_REEL_ID to id)).build().doWork()

    @Test fun theSchedulerQueuesOneJobPerReelAndReplacesIt() {
        val scheduler = WorkReminderScheduler(context)
        scheduler.schedule(5, System.currentTimeMillis() + 3_600_000)
        assertEquals(listOf(WorkInfo.State.ENQUEUED), states(5))
        scheduler.schedule(5, System.currentTimeMillis() + 7_200_000)
        assertEquals(1, states(5).count { it == WorkInfo.State.ENQUEUED })
        scheduler.cancel(5)
        assertTrue(states(5).none { it == WorkInfo.State.ENQUEUED })
    }

    @Test fun theWorkerShowsTheNotificationAndClearsTheReminder() = runBlocking {
        shadowOf(context as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val id = reelWithDate(LocalDate.now().plusDays(3))
        assertEquals(ListenableWorker.Result.success(), runWorker(id))
        val shown = notifications()
        assertEquals(1, shown.size)
        assertTrue(shown[0].extras.getString("android.title")!!.startsWith("On "))
        assertNotNull(shown[0].contentIntent)
        val reel = app.repository.observeReel(id).first()!!
        assertNull(reel.remindAt)
        assertNotNull(reel.eventDate)
    }

    @Test fun aReminderThatWasRemovedShowsNothing() = runBlocking {
        shadowOf(context as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val id = reelWithDate(LocalDate.now().plusDays(3))
        app.repository.setEventDate(id, null)
        assertEquals(ListenableWorker.Result.success(), runWorker(id))
        assertEquals(0, notifications().size)
    }

    @Test fun withoutNotificationPermissionNothingIsShownAndNothingCrashes() = runBlocking {
        val id = reelWithDate(LocalDate.now().plusDays(3))
        assertEquals(ListenableWorker.Result.success(), runWorker(id))
        assertEquals(0, notifications().size)
    }

    @Test fun aDeletedReelIsIgnored() = runBlocking {
        shadowOf(context as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        assertEquals(ListenableWorker.Result.success(), runWorker(9999))
        assertEquals(0, notifications().size)
    }

    @Test fun theTitleSaysTodayTomorrowOrTheDate() {
        val reel = com.reelbox.app.data.ReelEntity(1, "u", "k", com.reelbox.app.data.Platform.INSTAGRAM, "x", "Christmas market", null, null, "", null, "", null,
            com.reelbox.app.data.ReelStatus.NEW, 1, "", com.reelbox.app.data.EnrichState.MANUAL, false, 0, null)
        val today = LocalDate.of(2026, 12, 24)
        assertEquals("Today: Christmas market", Notifications.title(reel, today, today))
        assertEquals("Tomorrow: Christmas market", Notifications.title(reel, today.plusDays(1), today))
        assertTrue(Notifications.title(reel, today.plusDays(5), today).startsWith("On "))
    }
}
