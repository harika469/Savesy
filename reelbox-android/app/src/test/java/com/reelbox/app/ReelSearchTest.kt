package com.reelbox.app

import com.reelbox.app.data.EnrichState
import com.reelbox.app.data.FolderEntity
import com.reelbox.app.data.Platform
import com.reelbox.app.data.ReelEntity
import com.reelbox.app.data.ReelStatus
import com.reelbox.app.data.ReelWithFolder
import com.reelbox.app.domain.ReelSearch
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReelSearchTest {
    private fun item(title: String, caption: String = "", creator: String? = null, tags: String = "", note: String = "", folder: String = "Inbox") =
        ReelWithFolder(
            ReelEntity(1, "u", "k", Platform.INSTAGRAM, "x", title, creator, null, caption, null, tags, null, ReelStatus.NEW, 1, note, EnrichState.ENRICHED, false, 0, null),
            FolderEntity(1, folder, "📥"),
        )

    @Test fun emptyQueryMatchesEverything() = assertTrue(ReelSearch.matches(item("x"), "  "))

    @Test fun matchesAcrossFields() {
        val i = item("Paneer Butter Masala", creator = "@foodie_harika", tags = "recipe,dinner", note = "Try Sunday", folder = "Recipes")
        listOf("paneer", "FOODIE", "dinner", "sunday", "recipes", "instagram").forEach { assertTrue(it, ReelSearch.matches(i, it)) }
    }

    @Test fun everyWordMustMatch() {
        val i = item("Hidden Cafe in Amsterdam")
        assertTrue(ReelSearch.matches(i, "cafe amsterdam"))
        assertFalse(ReelSearch.matches(i, "cafe rotterdam"))
    }

    @Test fun ignoresAccents() = assertTrue(ReelSearch.matches(item("Café Zoë"), "cafe zoe"))

    @Test fun toleratesOneTypoOnLongerWords() {
        assertTrue(ReelSearch.matches(item("Amsterdam cafe"), "amstrdam"))
        assertTrue(ReelSearch.matches(item("Amsterdam cafe"), "amsterdan"))
        assertFalse(ReelSearch.matches(item("Amsterdam cafe"), "rotterdam"))
    }

    @Test fun shortWordsAreNotFuzzy() = assertFalse(ReelSearch.matches(item("cat"), "cut"))
}
