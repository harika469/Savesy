package com.reelbox.app

import com.reelbox.app.data.Platform
import com.reelbox.app.domain.EmbedUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EmbedUrlTest {
    @Test fun instagramEmbedIsThePermalinkPlusEmbedCaptioned() {
        assertEquals("https://www.instagram.com/reel/DfHfFlIhjUI/embed/captioned/", EmbedUrl.forReel(Platform.INSTAGRAM, "https://www.instagram.com/reel/DfHfFlIhjUI/"))
    }

    @Test fun facebookUsesTheVideoPluginWithAnEncodedHref() {
        val url = EmbedUrl.forReel(Platform.FACEBOOK, "https://www.facebook.com/reel/987654")
        assertTrue(url, url.startsWith("https://www.facebook.com/plugins/video.php?"))
        assertTrue(url, url.endsWith("href=https%3A%2F%2Fwww.facebook.com%2Freel%2F987654"))
    }

    @Test fun onlyInstagramAndFacebookHostsMayLoadInsideTheApp() {
        assertTrue(EmbedUrl.isEmbedHost("https://www.instagram.com/reel/x/embed/captioned/"))
        assertTrue(EmbedUrl.isEmbedHost("https://scontent.cdninstagram.com/v/t51/x.jpg"))
        assertFalse(EmbedUrl.isEmbedHost("https://evil.example.com/embed"))
        assertFalse(EmbedUrl.isEmbedHost("not a url"))
        assertFalse(EmbedUrl.isEmbedHost("https://instagram.com.evil.com/embed"))
    }
}
