package com.reelbox.app

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.reelbox.app.data.AppDatabase
import com.reelbox.app.data.CaptureResult
import com.reelbox.app.data.EnrichState
import com.reelbox.app.data.NOTE_LIMIT
import com.reelbox.app.data.ReelRepository
import com.reelbox.app.data.ReelStatus
import com.reelbox.app.domain.EnrichResult
import com.reelbox.app.domain.Enrichment
import com.reelbox.app.domain.ParsedLink
import com.reelbox.app.domain.MetadataProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private class FakeEnricher(var result: EnrichResult) : MetadataProvider {
    override suspend fun enrich(link: ParsedLink) = result
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReelRepositoryTest {
    private lateinit var db: AppDatabase
    private lateinit var enricher: FakeEnricher
    private lateinit var repo: ReelRepository

    private val recipe = Enrichment(
        title = "15-min Paneer Butter Masala", caption = "Easy dinner recipe! #recipe #dinner",
        creatorName = "foodie_harika", creatorHandle = "@foodie_harika", thumbnailUrl = "https://img/x.jpg",
    )

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        enricher = FakeEnricher(EnrichResult.Success(recipe))
        repo = ReelRepository(db, enricher, now = { 1_000L })
    }

    @After fun tearDown() = db.close()

    private suspend fun capture(text: String) = repo.capture(text) as CaptureResult.Saved

    @Test fun systemFoldersAreCreatedOnce() = runBlocking {
        repo.ensureSystemFolders(); repo.ensureSystemFolders()
        assertEquals(listOf("Inbox", "Recipes", "Travel", "Fashion", "Home", "Motivation", "To Try"), repo.getFolders().map { it.name })
    }

    @Test fun captureSavesToInboxImmediately() = runBlocking {
        val saved = capture("look https://www.instagram.com/reel/AAA111/?igsh=zzz")
        assertEquals("Inbox", repo.getFolders().first { it.id == saved.reel.folderId }.name)
        assertEquals(EnrichState.PENDING, saved.reel.enrichState)
        assertEquals("https://www.instagram.com/reel/AAA111/", saved.reel.permalink)
    }

    @Test fun enrichFillsDetailsAndAutoFilesIntoRecipes() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/AAA111/")
        val outcome = repo.enrich(saved.reel.id)!!
        assertEquals("Recipes", outcome.folder?.name)
        assertEquals("@foodie_harika", outcome.reel.creatorHandle)
        assertEquals("15-min Paneer Butter Masala", outcome.reel.title)
        assertEquals(EnrichState.ENRICHED, outcome.reel.enrichState)
        assertTrue("recipe" in outcome.reel.tagList)
        assertEquals("Recipes", repo.observeReels().first().single().folder?.name)
    }

    @Test fun duplicateIsDetectedAcrossUrlVariants() = runBlocking {
        val first = capture("https://www.instagram.com/reel/AAA111/")
        val again = repo.capture("https://instagram.com/reels/AAA111/?utm_source=x")
        assertTrue(again is CaptureResult.Duplicate)
        assertEquals(first.reel.id, (again as CaptureResult.Duplicate).reel.id)
        assertEquals(1, repo.observeReels().first().size)
    }

    @Test fun publicEmbedWithoutMetadataKeepsSharedCaptionAndClassifies() = runBlocking {
        enricher.result = EnrichResult.DisplayOnly
        val saved = capture("Easy dinner recipe #recipe https://www.instagram.com/reel/AAA111/")
        val outcome = repo.enrich(saved.reel.id)!!
        assertEquals("Recipes", outcome.folder?.name)
        assertEquals("Easy dinner recipe #recipe", outcome.reel.caption)
        assertEquals("Easy dinner recipe #recipe", outcome.reel.title)
        assertEquals(EnrichState.MANUAL, outcome.reel.enrichState)
    }

    @Test fun metadataDoesNotReplaceUserSuppliedFields() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/AAA111/")
        repo.setCaptionFromText(saved.reel.id, "My own caption")
        repo.setTitle(saved.reel.id, "My chosen title")
        val out = repo.enrich(saved.reel.id)!!
        assertEquals("My chosen title", out.reel.title)
        assertEquals("My own caption", out.reel.caption)
        assertEquals("@foodie_harika", out.reel.creatorHandle)
    }

    @Test fun invalidTextIsRejected() = runBlocking {
        assertEquals(CaptureResult.Invalid, repo.capture("hello"))
        assertEquals(CaptureResult.Invalid, repo.capture("https://example.com/reel/1"))
    }

    @Test fun offlineKeepsReelPendingAndRetryCompletesIt() = runBlocking {
        enricher.result = EnrichResult.Offline
        val saved = capture("https://www.instagram.com/reel/AAA111/")
        repo.enrich(saved.reel.id)
        assertEquals(EnrichState.PENDING, repo.observeReel(saved.reel.id).first()!!.enrichState)

        enricher.result = EnrichResult.Success(recipe)
        repo.retryPending()
        val done = repo.observeReel(saved.reel.id).first()!!
        assertEquals(EnrichState.ENRICHED, done.enrichState)
        assertEquals("@foodie_harika", done.creatorHandle)
    }

    @Test fun privateReelBecomesManualAndStaysInInbox() = runBlocking {
        enricher.result = EnrichResult.Unavailable
        val saved = capture("https://www.instagram.com/reel/PRIV1/")
        val outcome = repo.enrich(saved.reel.id)!!
        assertEquals(EnrichState.MANUAL, outcome.reel.enrichState)
        assertEquals("Inbox", outcome.folder?.name)
    }

    @Test fun enrichNeverOverridesAFolderTheUserChose() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/AAA111/")
        val travel = repo.getFolders().first { it.name == "Travel" }
        repo.moveToFolder(saved.reel.id, travel.id)
        assertEquals("Travel", repo.enrich(saved.reel.id)!!.folder?.name)
    }

    @Test fun statusNoteAndOpenedAreSaved() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/AAA111/")
        repo.setStatus(saved.reel.id, ReelStatus.TO_TRY)
        repo.setNote(saved.reel.id, "x".repeat(NOTE_LIMIT + 50))
        repo.markOpened(saved.reel.id)
        val r = repo.observeReel(saved.reel.id).first()!!
        assertEquals(ReelStatus.TO_TRY, r.status)
        assertEquals(NOTE_LIMIT, r.note.length)
        assertEquals(1_000L, r.lastOpenedAt)
    }

    @Test fun deleteRemovesTheReelAndAllowsSavingItAgain() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/AAA111/")
        repo.delete(saved.reel.id)
        assertEquals(0, repo.observeReels().first().size)
        assertNotNull(capture("https://www.instagram.com/reel/AAA111/"))
    }

    @Test fun trackingParametersNeverEndUpAsTheCaption() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/DfHfFlIhjUI/?knvt=MXVlMnI0b3I1eXkzMw==")
        assertEquals("", saved.reel.caption)
        assertEquals("", saved.reel.hashtags)
        val withText = capture("Look at this #recipe https://www.instagram.com/reel/ZZZ999/?igsh=abc")
        assertEquals("Look at this #recipe", withText.reel.caption)
        assertEquals("recipe", withText.reel.hashtags)
    }

    @Test fun describeTurnsWordsIntoTitleTagsAndFolder() = runBlocking {
        enricher.result = EnrichResult.Unavailable
        val saved = capture("https://www.instagram.com/reel/DfHfFlIhjUI/")
        repo.enrich(saved.reel.id)
        val out = repo.describe(saved.reel.id, "paneer butter masala recipe, want to cook this Sunday")!!
        assertEquals("Recipes", out.folder?.name)
        assertEquals("Paneer butter masala recipe, want to cook this Sunday", out.reel.title)
        assertEquals("paneer butter masala recipe, want to cook this Sunday", out.reel.note)
        assertTrue("recipe" in out.reel.tagList)
        assertTrue(out.reel.tagList.size <= 5)
    }

    @Test fun describeNeverMovesAReelOutOfAFolderTheUserPicked() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/DfHfFlIhjUI/")
        val travel = repo.getFolders().first { it.name == "Travel" }
        repo.moveToFolder(saved.reel.id, travel.id)
        assertEquals("Travel", repo.describe(saved.reel.id, "pasta recipe")!!.folder?.name)
    }

    @Test fun describeKeepsAnExistingTitleAndAppendsToTheNote() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/DfHfFlIhjUI/")
        repo.setTitle(saved.reel.id, "My title")
        repo.setNote(saved.reel.id, "first")
        val out = repo.describe(saved.reel.id, "second thought")!!
        assertEquals("My title", out.reel.title)
        assertEquals("first\nsecond thought", out.reel.note)
    }

    @Test fun describeIgnoresBlankText() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/DfHfFlIhjUI/")
        assertEquals(null, repo.describe(saved.reel.id, "   "))
    }

    @Test fun deriveTitleIsShortAndCapitalised() {
        assertEquals("Hidden cafe in amsterdam", com.reelbox.app.data.deriveTitle("hidden cafe in amsterdam. so good!"))
        assertTrue(com.reelbox.app.data.deriveTitle("a ".repeat(80)).length <= 62)
        assertEquals("Saved reel", com.reelbox.app.data.deriveTitle("   "))
    }

    @Test fun isSavedRecognisesTheSameReelInAnyUrlForm() = runBlocking {
        capture("https://www.instagram.com/reel/DfHfFlIhjUI/")
        assertTrue(repo.isSaved("https://instagram.com/reels/DfHfFlIhjUI/?knvt=x"))
        assertTrue(!repo.isSaved("https://www.instagram.com/reel/OTHER/"))
        assertTrue(!repo.isSaved("not a link"))
    }

    @Test fun screenshotFillsCreatorCaptionTagsThumbnailAndFiles() = runBlocking {
        enricher.result = EnrichResult.Unavailable
        val saved = capture("https://www.instagram.com/reel/DfHfFlIhjUI/")
        val info = com.reelbox.app.domain.ScreenshotInfo("@foodie_harika", "Easy paneer butter masala in 15 minutes! Full recipe below #recipe #dinner", listOf("recipe", "dinner"), "foodie_harika · Original audio")
        val out = repo.applyScreenshot(saved.reel.id, info, "file:///thumbs/1.jpg")!!
        assertEquals("@foodie_harika", out.reel.creatorHandle)
        assertEquals("Easy paneer butter masala in 15 minutes", out.reel.title)
        assertEquals("file:///thumbs/1.jpg", out.reel.thumbnailUrl)
        assertEquals("foodie_harika · Original audio", out.reel.audioName)
        assertEquals("Recipes", out.folder?.name)
        assertEquals(listOf("recipe", "dinner"), out.reel.tagList.take(2))
        assertEquals(EnrichState.ENRICHED, out.reel.enrichState)
    }

    @Test fun screenshotKeepsExistingDetailsWhenItFindsNothing() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/DfHfFlIhjUI/")
        repo.setTitle(saved.reel.id, "My title")
        val empty = com.reelbox.app.domain.ScreenshotInfo(null, "", emptyList(), null)
        assertEquals(null, repo.applyScreenshot(saved.reel.id, empty, null))
        val onlyThumb = repo.applyScreenshot(saved.reel.id, empty, "file:///t.jpg")!!
        assertEquals("My title", onlyThumb.reel.title)
        assertEquals("file:///t.jpg", onlyThumb.reel.thumbnailUrl)
    }

    @Test fun screenshotNeverMovesAReelOutOfAChosenFolder() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/DfHfFlIhjUI/")
        repo.moveToFolder(saved.reel.id, repo.getFolders().first { it.name == "Travel" }.id)
        val info = com.reelbox.app.domain.ScreenshotInfo("@x", "pasta recipe #recipe", listOf("recipe"), null)
        assertEquals("Travel", repo.applyScreenshot(saved.reel.id, info, null)!!.folder?.name)
    }

    @Test fun deleteReturnsTheThumbnailSoItsFileCanBeRemoved() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/DfHfFlIhjUI/")
        repo.applyScreenshot(saved.reel.id, com.reelbox.app.domain.ScreenshotInfo(null, "", emptyList(), null), "file:///t.jpg")
        assertEquals("file:///t.jpg", repo.delete(saved.reel.id))
        assertEquals(null, repo.delete(saved.reel.id))
    }

    @Test fun pastedLongCaptionIsStoredInFullFiledAndSearchable() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/DfHfFlIhjUI/")
        val long = "Easy dinner recipe for the whole family. " + "Stir well and keep going. ".repeat(150) + "Finish with zaatar and lemon #recipe #dinner"
        val out = repo.setCaptionFromText(saved.reel.id, long)!!
        assertEquals(long.trim(), out.reel.caption)
        assertEquals("Recipes", out.folder?.name)
        val found = repo.observeReels().first().filter { com.reelbox.app.domain.ReelSearch.matches(it, "zaatar") }
        assertEquals(1, found.size)
    }

    @Test fun blankPastedCaptionIsIgnored() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/DfHfFlIhjUI/")
        assertEquals(null, repo.setCaptionFromText(saved.reel.id, "  \n "))
    }

    @Test fun unavailableFlagCanBeSetAndClearedWithoutLosingNotes() = runBlocking {
        val saved = capture("https://www.instagram.com/reel/DfHfFlIhjUI/")
        repo.setNote(saved.reel.id, "keep me")
        repo.setUnavailable(saved.reel.id, true)
        assertTrue(repo.observeReel(saved.reel.id).first()!!.isUnavailable)
        repo.setUnavailable(saved.reel.id, false)
        val r = repo.observeReel(saved.reel.id).first()!!
        assertEquals(false, r.isUnavailable)
        assertEquals("keep me", r.note)
    }
}
