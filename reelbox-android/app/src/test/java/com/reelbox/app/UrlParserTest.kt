package com.reelbox.app

import com.reelbox.app.data.Platform
import com.reelbox.app.domain.UrlParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class UrlParserTest {
    @Test fun instagramShareTextWithTrackingParams() {
        val link = UrlParser.parse("Check out this reel https://www.instagram.com/reel/Cabc123XyZ/?igsh=MWx4aGp0 !")!!
        assertEquals(Platform.INSTAGRAM, link.platform)
        assertEquals("Cabc123XyZ", link.platformId)
        assertEquals("https://www.instagram.com/reel/Cabc123XyZ/", link.permalink)
        assertEquals("ig:Cabc123XyZ", link.key)
    }

    @Test fun instagramReelsAndReelAreTheSameContent() {
        assertEquals(UrlParser.parse("https://instagram.com/reels/AAA111/")!!.key, UrlParser.parse("https://www.instagram.com/reel/AAA111")!!.key)
    }

    @Test fun instagramUsernamePrefixedReel() {
        assertEquals("ig:AAA111", UrlParser.parse("https://www.instagram.com/someone/reel/AAA111/")!!.key)
    }

    @Test fun instagramPostAndShortHost() {
        assertEquals("ig:POST9", UrlParser.parse("https://instagr.am/p/POST9/")!!.key)
    }

    @Test fun facebookReelWatchAndShortLinks() {
        assertEquals("fb:123456", UrlParser.parse("https://www.facebook.com/reel/123456?mibextid=abc")!!.key)
        assertEquals("fb:777", UrlParser.parse("https://m.facebook.com/watch/?v=777&t=3")!!.key)
        assertEquals("fb:short:aBcD", UrlParser.parse("https://fb.watch/aBcD/")!!.key)
        assertEquals("fb:share:1Abc", UrlParser.parse("https://www.facebook.com/share/r/1Abc/")!!.key)
        assertEquals(Platform.FACEBOOK, UrlParser.parse("https://www.facebook.com/reel/42")!!.platform)
    }

    @Test fun rejectsOtherLinksAndPlainText() {
        assertNull(UrlParser.parse("https://example.com/reel/123"))
        assertNull(UrlParser.parse("https://www.instagram.com/someprofile/"))
        assertNull(UrlParser.parse("no link in here"))
        assertNull(UrlParser.parse(""))
    }

    @Test fun extractsUrlAndTrimsPunctuation() {
        assertEquals("https://www.instagram.com/reel/X1/", UrlParser.extractUrl("see (https://www.instagram.com/reel/X1/)."))
        assertNotNull(UrlParser.extractUrl("a https://fb.watch/q/ b"))
    }
}
