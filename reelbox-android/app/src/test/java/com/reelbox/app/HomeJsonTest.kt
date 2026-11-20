package com.reelbox.app

import com.reelbox.app.data.EnrichState
import com.reelbox.app.data.FolderEntity
import com.reelbox.app.data.Platform
import com.reelbox.app.data.ReelEntity
import com.reelbox.app.data.ReelStatus
import com.reelbox.app.data.ReelWithFolder
import com.reelbox.app.ui.HomeJson
import com.reelbox.app.ui.HomeState
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HomeJsonTest {
    private val recipes = FolderEntity(2, "Recipes", "🍛")
    private val travel = FolderEntity(3, "Travel", "✈️")

    private fun reel(id: Long, title: String, creator: String?, folder: FolderEntity, tags: String, platform: Platform = Platform.INSTAGRAM) = ReelWithFolder(
        ReelEntity(id, "https://x/$id", "k$id", platform, "x", title, creator, null, "", null, tags, null, ReelStatus.NEW, folder.id, "", EnrichState.ENRICHED, false, 0, null),
        folder,
    )

    private fun state(reels: List<ReelWithFolder>, all: Int = reels.size, query: String = "", selected: Long? = null) =
        HomeState(reels, all, thisWeek = 2, folders = listOf(recipes, travel), selectedFolderId = selected, query = query)

    @Test fun realReelsBecomeCardsWithCreatorFolderTagsAndBadge() {
        val json = JSONObject(HomeJson.build(state(listOf(reel(1, "Paneer", "@foodie", recipes, "recipe,dinner,a,b"), reel(2, "Cafe", null, travel, "", Platform.FACEBOOK))), null))
        val cards = json.getJSONArray("reels")
        assertEquals(2, cards.length())
        val first = cards.getJSONObject(0)
        assertEquals("Paneer", first.getString("title"))
        assertEquals("@foodie • Recipes", first.getString("meta"))
        assertEquals(3, first.getJSONArray("tags").length())   // at most three pills, like the design
        assertEquals("IG", first.getString("badge"))
        assertEquals("🍛", first.getString("emoji"))
        assertFalse(first.getBoolean("sample"))
        val second = cards.getJSONObject(1)
        assertEquals("Facebook • Travel", second.getString("meta"))
        assertEquals("FB", second.getString("badge"))
    }

    @Test fun statsAndChipsFollowTheState() {
        val json = JSONObject(HomeJson.build(state(listOf(reel(1, "x", null, recipes, "")), selected = 3), null))
        assertEquals(1, json.getJSONObject("stats").getInt("saved"))
        assertEquals(2, json.getJSONObject("stats").getInt("folders"))
        assertEquals(2, json.getJSONObject("stats").getInt("week"))
        val chips = json.getJSONArray("chips")
        assertEquals(listOf("All", "Recipes", "Travel"), (0 until 3).map { chips.getJSONObject(it).getString("name") })
        assertFalse(chips.getJSONObject(0).getBoolean("active"))
        assertTrue(chips.getJSONObject(2).getBoolean("active"))
        assertTrue(chips.getJSONObject(0).isNull("id"))
    }

    @Test fun anEmptyLibraryShowsSixSampleReelsThatAreNotCounted() {
        val json = JSONObject(HomeJson.build(state(emptyList()), null))
        assertTrue(json.getBoolean("sample"))
        assertEquals(6, json.getJSONArray("reels").length())
        assertEquals(0, json.getJSONObject("stats").getInt("saved"))
        assertEquals("Sample", json.getJSONArray("reels").getJSONObject(0).getString("badge"))
        assertTrue(json.getJSONArray("reels").getJSONObject(0).getBoolean("sample"))
        assertTrue(json.isNull("emptyMessage"))
    }

    @Test fun samplesNeverAppearOnceTheUserSearchesOrFilters() {
        assertFalse(JSONObject(HomeJson.build(state(emptyList(), query = "pasta"), null)).getBoolean("sample"))
        assertFalse(JSONObject(HomeJson.build(state(emptyList(), selected = 2), null)).getBoolean("sample"))
        assertEquals("Nothing saved here yet.", JSONObject(HomeJson.build(state(emptyList(), selected = 2), null)).getString("emptyMessage"))
        assertEquals("No reels match that.", JSONObject(HomeJson.build(state(emptyList(), all = 5, query = "zzz"), null)).getString("emptyMessage"))
    }

    @Test fun hostileTextStaysPlainData() {
        val nasty = "\"; alert(1); </script><img src=x onerror=alert(2)>  "
        val json = HomeJson.build(state(listOf(reel(1, nasty, "@<b>x</b>", recipes, "tag"))), null)
        // The title survives exactly (the page uses textContent, never innerHTML) and the JSON stays valid.
        assertEquals(nasty, JSONObject(json).getJSONArray("reels").getJSONObject(0).getString("title"))
    }

    @Test fun clipboardBannerShowsAShortLink() {
        val json = JSONObject(HomeJson.build(state(emptyList()), "https://www.instagram.com/reel/DeG_FtSJmIR/"))
        assertEquals("instagram.com/reel/DeG_FtSJmIR/", json.getJSONObject("banner").getString("link"))
        assertTrue(JSONObject(HomeJson.build(state(emptyList()), null)).isNull("banner"))
    }

    @Test fun gradientsMatchTheDesignOrderAndNeverFailOnNegativeIds() {
        assertEquals(0, HomeJson.gradientIndex(6)); assertEquals(1, HomeJson.gradientIndex(7)); assertEquals(5, HomeJson.gradientIndex(-1))
        val cards = JSONObject(HomeJson.build(state(emptyList()), null)).getJSONArray("reels")
        assertEquals("#f97316", cards.getJSONObject(0).getString("from"))
        assertEquals("#8b5cf6", cards.getJSONObject(5).getString("from"))
    }
}
