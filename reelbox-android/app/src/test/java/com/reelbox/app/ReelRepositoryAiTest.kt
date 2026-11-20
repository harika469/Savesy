package com.reelbox.app

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.reelbox.app.data.AppDatabase
import com.reelbox.app.data.CaptureResult
import com.reelbox.app.data.OrganiseOutcome
import com.reelbox.app.data.ReelRepository
import com.reelbox.app.data.ai
import com.reelbox.app.data.userMessage
import com.reelbox.app.domain.AiOrganiser
import com.reelbox.app.domain.AiResult
import com.reelbox.app.domain.ManualProvider
import com.reelbox.app.domain.ReelAi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private class FakeAi(var result: AiResult) : AiOrganiser {
    var calls = 0
    var lastText = ""
    var lastFolders: List<String> = emptyList()
    override suspend fun organise(text: String, creator: String?, folders: List<String>): AiResult {
        calls++; lastText = text; lastFolders = folders
        return result
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReelRepositoryAiTest {
    private lateinit var db: AppDatabase
    private lateinit var fake: FakeAi
    private lateinit var repo: ReelRepository

    private val recipe = ReelAi(
        title = "Creamy Dahi Pyaz Sabzi", summary = "A quick onion and curd curry.", category = "Recipes", tags = listOf("vegetarian", "quickmeals"),
        ingredients = listOf("Onions", "Curd"), locations = emptyList(), products = emptyList(),
        suggestedActions = listOf("create_shopping_list"), cookingTimeMinutes = 15,
    )
    private val caption = "Creamy dahi pyaz sabzi in 15 minutes. Onions, capsicum, curd and besan. #recipe"

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java).allowMainThreadQueries().build()
        fake = FakeAi(AiResult.Success(recipe))
        repo = ReelRepository(db, ManualProvider, ai = fake)
    }

    @After fun tearDown() = db.close()

    private suspend fun savedReel(withCaption: String? = caption): Long {
        val saved = repo.capture("https://www.instagram.com/reel/DfHfFlIhjUI/") as CaptureResult.Saved
        if (withCaption != null) repo.setCaptionFromText(saved.reel.id, withCaption)
        return saved.reel.id
    }

    @Test fun tooLittleTextNeverCallsTheAi() = runBlocking {
        val id = savedReel(withCaption = null)
        assertEquals(OrganiseOutcome.TooLittleText, repo.organiseWithAi(id))
        assertEquals(0, fake.calls)
    }

    @Test fun storesTheResultFilesTheReelAndSetsTheTitle() = runBlocking {
        val id = savedReel()
        val out = repo.organiseWithAi(id) as OrganiseOutcome.Done
        assertFalse(out.fromCache)
        assertEquals("Creamy Dahi Pyaz Sabzi", out.reel.title)
        assertEquals("Recipes", repo.getFolders().first { it.id == out.reel.folderId }.name)
        assertEquals(recipe, out.reel.ai)
        assertTrue("vegetarian" in out.reel.tagList)
        assertTrue(out.reel.tagList.size <= 5)
    }

    @Test fun unchangedTextIsServedFromTheCacheAndCostsNothing() = runBlocking {
        val id = savedReel()
        repo.organiseWithAi(id)
        val again = repo.organiseWithAi(id) as OrganiseOutcome.Done
        assertTrue(again.fromCache)
        assertEquals(1, fake.calls)
        repo.organiseWithAi(id, force = true)
        assertEquals(2, fake.calls)
    }

    @Test fun changedTextCallsTheAiAgain() = runBlocking {
        val id = savedReel()
        repo.organiseWithAi(id)
        repo.setNote(id, "Try this on Sunday with friends")
        repo.organiseWithAi(id)
        assertEquals(2, fake.calls)
    }

    @Test fun onlyTheUsersTextIsSentNeverTheLink() = runBlocking {
        val id = savedReel()
        repo.setNote(id, "my own note about it")
        repo.organiseWithAi(id)
        assertTrue(fake.lastText.contains("Creamy dahi pyaz sabzi"))
        assertTrue(fake.lastText.contains("my own note about it"))
        assertFalse(fake.lastText.contains("instagram.com"))
        assertTrue("Recipes" in fake.lastFolders && "Inbox" in fake.lastFolders)
    }

    @Test fun aTitleTheUserTypedIsKept() = runBlocking {
        val id = savedReel()
        repo.setTitle(id, "Mum's sabzi")
        val out = repo.organiseWithAi(id) as OrganiseOutcome.Done
        assertEquals("Mum's sabzi", out.reel.title)
    }

    @Test fun aFolderTheUserChoseIsKept() = runBlocking {
        val id = savedReel()
        repo.moveToFolder(id, repo.getFolders().first { it.name == "Travel" }.id)
        val out = repo.organiseWithAi(id) as OrganiseOutcome.Done
        assertEquals("Travel", repo.getFolders().first { it.id == out.reel.folderId }.name)
        assertNotNull(out.reel.aiJson)
    }

    @Test fun anUnknownCategoryLeavesTheReelInInbox() = runBlocking {
        fake.result = AiResult.Success(recipe.copy(category = "Cooking"))
        val id = savedReel(withCaption = "Something worth remembering for later on")
        val out = repo.organiseWithAi(id) as OrganiseOutcome.Done
        assertEquals("Inbox", repo.getFolders().first { it.id == out.reel.folderId }.name)
    }

    @Test fun failuresAreReportedAndNothingIsCached() = runBlocking {
        val id = savedReel()
        fake.result = AiResult.LimitReached
        assertEquals(OrganiseOutcome.LimitReached, repo.organiseWithAi(id))
        fake.result = AiResult.Offline
        assertEquals(OrganiseOutcome.Offline, repo.organiseWithAi(id))
        fake.result = AiResult.NotConfigured
        assertEquals(OrganiseOutcome.NotConfigured, repo.organiseWithAi(id))
        fake.result = AiResult.Failed("x")
        assertTrue(repo.organiseWithAi(id) is OrganiseOutcome.Failed)
        assertNull(repo.observeReel(id).first()?.aiJson)
    }

    @Test fun userMessagesAreOnlyShownWhenUseful() {
        assertNull(OrganiseOutcome.NotConfigured.userMessage())
        assertNull(OrganiseOutcome.TooLittleText.userMessage())
        assertNull(OrganiseOutcome.Done(dummyReel(), fromCache = true).userMessage())
        assertEquals("Organised with AI", OrganiseOutcome.Done(dummyReel(), fromCache = false).userMessage())
        assertTrue(OrganiseOutcome.LimitReached.userMessage()!!.contains("limit"))
        assertTrue(OrganiseOutcome.Offline.userMessage()!!.contains("connection"))
    }

    private fun dummyReel() = com.reelbox.app.data.ReelEntity(
        1, "u", "k", com.reelbox.app.data.Platform.INSTAGRAM, "x", "t", null, null, "", null, "", null,
        com.reelbox.app.data.ReelStatus.NEW, 1, "", com.reelbox.app.data.EnrichState.MANUAL, false, 0, null,
    )
}
