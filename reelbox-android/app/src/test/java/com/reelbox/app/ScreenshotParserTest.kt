package com.reelbox.app

import com.reelbox.app.domain.OcrLine
import com.reelbox.app.domain.ScreenshotParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenshotParserTest {
    private val h = 2400

    /** Text roughly as ML Kit reads a reel screenshot: right-hand counts, then creator, caption and audio at the bottom. */
    private val reel = listOf(
        OcrLine("Reels", 90),
        OcrLine("12.5K", 1500, 980),
        OcrLine("348", 1700, 990),
        OcrLine("foodie_harika · Follow", 1900, 120),
        OcrLine("Easy paneer butter masala in 15 minutes!", 1965, 60),
        OcrLine("Full recipe below #recipe #dinner … more", 2020, 60),
        OcrLine("♫ foodie_harika · Original audio", 2090, 60),
    )

    @Test fun readsCreatorCaptionHashtagsAndAudioFromAReel() {
        val r = ScreenshotParser.parse(reel, h)
        assertEquals("@foodie_harika", r.handle)
        assertEquals("Easy paneer butter masala in 15 minutes! Full recipe below #recipe #dinner", r.caption)
        assertEquals(listOf("recipe", "dinner"), r.hashtags)
        assertEquals("foodie_harika · Original audio", r.audio)
    }

    @Test fun creatorOnItsOwnLineStillWorks() {
        val r = ScreenshotParser.parse(listOf(
            OcrLine("wanderlust", 1880), OcrLine("Follow", 1885, 400),
            OcrLine("Hidden cafe in Amsterdam you need to visit", 1950),
            OcrLine("Original audio", 2050),
        ), h)
        assertEquals("@wanderlust", r.handle)
        assertEquals("Hidden cafe in Amsterdam you need to visit", r.caption)
    }

    @Test fun postHeaderAtTheTopCountsAsCreator() {
        val r = ScreenshotParser.parse(listOf(OcrLine("style_diary", 150), OcrLine("Wedding outfit ideas #grwm", 1800)), h)
        assertEquals("@style_diary", r.handle)
        assertEquals(listOf("grwm"), r.hashtags)
    }

    @Test fun countsAndButtonsAreNotMistakenForACreator() {
        val r = ScreenshotParser.parse(listOf(OcrLine("12.5K", 1900), OcrLine("Share", 1950), OcrLine("Comments", 2000), OcrLine("1234", 2050)), h)
        assertNull(r.handle)
        assertEquals("", r.caption)
    }

    @Test fun captionIsKeptEvenWhenNoCreatorIsFound() {
        val r = ScreenshotParser.parse(listOf(OcrLine("Best pasta recipe you will ever make", 1900), OcrLine("#pasta", 1960)), h)
        assertNull(r.handle)
        assertTrue(r.caption.startsWith("Best pasta recipe"))
        assertEquals(listOf("pasta"), r.hashtags)
    }

    @Test fun emptyScreenshotGivesEmptyResult() {
        assertTrue(ScreenshotParser.parse(emptyList(), h).isEmpty)
    }

    @Test fun hashtagsAreDeduplicatedAndLowercased() {
        assertEquals(listOf("cafe", "reis"), ScreenshotParser.parse(listOf(OcrLine("#Cafe #reis #cafe", 2000)), h).hashtags)
    }

    @Test fun moreSuffixIsRemoved() {
        val r = ScreenshotParser.parse(listOf(OcrLine("creator_one · Follow", 1900), OcrLine("A short caption ...more", 1960)), h)
        assertEquals("A short caption", r.caption)
    }
}
