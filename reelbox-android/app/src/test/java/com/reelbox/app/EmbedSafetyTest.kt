package com.reelbox.app

import com.reelbox.app.data.Platform
import com.reelbox.app.domain.EmbedDecision
import com.reelbox.app.domain.EmbedHtml
import com.reelbox.app.domain.EmbedPolicy
import com.reelbox.app.domain.OEmbedResult
import com.reelbox.app.domain.decideEmbed
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EmbedSafetyTest {
    private val instagramHtml = """<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/reel/x/" style="background:#FFF"><a href="https://www.instagram.com/reel/x/">View this post on Instagram</a></blockquote>"""

    @Test fun sanitiseKeepsTheEmbedAndStripsEveryScript() {
        val dirty = instagramHtml + """<script async src="//www.instagram.com/embed.js"></script><script>alert(1)</script><SCRIPT SRC="https://evil.example/x.js"></SCRIPT>"""
        val clean = EmbedHtml.sanitize(Platform.INSTAGRAM, dirty)!!
        assertTrue(clean.contains("instagram-media"))
        assertFalse(clean.contains("<script", ignoreCase = true))
        assertFalse(clean.contains("alert(1)"))
    }

    @Test fun sanitiseRemovesEventHandlersAndJavascriptLinks() {
        val dirty = """<blockquote class="instagram-media" onclick="steal()" onmouseover='x()'><a href="javascript:steal()">hi</a><img src=x onerror=steal()></blockquote>"""
        val clean = EmbedHtml.sanitize(Platform.INSTAGRAM, dirty)!!
        assertFalse(clean, clean.contains("onclick", true) || clean.contains("onmouseover", true) || clean.contains("onerror", true))
        assertFalse(clean, clean.contains("javascript:", true))
    }

    @Test fun sanitiseRejectsMarkupThatIsNotAnEmbedForThatPlatform() {
        assertNull(EmbedHtml.sanitize(Platform.INSTAGRAM, "<div>surprise</div>"))
        assertNull(EmbedHtml.sanitize(Platform.INSTAGRAM, """<div class="fb-video"></div>"""))
        assertNotNull(EmbedHtml.sanitize(Platform.FACEBOOK, """<div id="fb-root"></div><script>x()</script><div class="fb-video" data-href="https://www.facebook.com/reel/1"></div>"""))
    }

    @Test fun thePageHasAStrictPolicyAndExactlyOneOfficialScript() {
        val page = EmbedHtml.page(Platform.INSTAGRAM, EmbedHtml.sanitize(Platform.INSTAGRAM, instagramHtml)!!)
        assertTrue(page.contains("Content-Security-Policy"))
        assertTrue(page.contains("default-src 'none'"))
        assertEquals(1, Regex("<script", RegexOption.IGNORE_CASE).findAll(page).count())
        assertTrue(page.contains("""<script async defer src="https://www.instagram.com/embed.js">"""))
        val facebook = EmbedHtml.page(Platform.FACEBOOK, """<div class="fb-video"></div>""")
        assertTrue(facebook.contains("https://connect.facebook.net/en_US/sdk.js"))
    }

    @Test fun onlyHttpsInstagramAndFacebookHostsAreAllowed() {
        listOf(
            "https://www.instagram.com/reel/x/embed/captioned/", "https://instagram.com/embed.js",
            "https://scontent-ams4-1.cdninstagram.com/v/x.jpg", "https://static.xx.fbcdn.net/rsrc.php/x.js",
            "https://connect.facebook.net/en_US/sdk.js", "https://www.facebook.com/plugins/video.php",
        ).forEach { assertTrue(it, EmbedPolicy.isAllowed(it)) }
        listOf(
            "http://www.instagram.com/embed", "https://instagram.com.evil.com/embed", "https://evilinstagram.com/",
            "https://example.com/", "javascript:alert(1)", "intent://scan/#Intent;scheme=zxing;end", "file:///data/data/x",
            "data:text/html,<script>1</script>", "not a url", "",
        ).forEach { assertFalse(it, EmbedPolicy.isAllowed(it)) }
    }

    @Test fun inPageResourcesMayUseAboutBlankAndInlineImagesOnly() {
        assertTrue(EmbedPolicy.isAllowedResource("about:blank"))
        assertTrue(EmbedPolicy.isAllowedResource("data:image/png;base64,AAAA"))
        assertFalse(EmbedPolicy.isAllowedResource("data:text/html,<b>x</b>"))
        assertFalse(EmbedPolicy.isAllowedResource("http://www.instagram.com/x.png"))
    }

    @Test fun linksLeavingTheEmbedOpenExternallyOnlyOverHttps() {
        assertTrue(EmbedPolicy.mayOpenExternally("https://www.instagram.com/someone/"))
        assertFalse(EmbedPolicy.mayOpenExternally("intent://x"))
        assertFalse(EmbedPolicy.mayOpenExternally("javascript:alert(1)"))
        assertFalse(EmbedPolicy.mayOpenExternally("file:///x"))
    }

    @Test fun decisionsForEveryMetaAnswer() {
        val ok = OEmbedResult.Success(instagramHtml, null, null, null)
        assertTrue(decideEmbed(Platform.INSTAGRAM, ok) is EmbedDecision.Show)
        assertTrue(decideEmbed(Platform.INSTAGRAM, OEmbedResult.Success("<div>other</div>", null, null, null)) is EmbedDecision.Fallback)
        assertTrue(decideEmbed(Platform.INSTAGRAM, OEmbedResult.RateLimited) is EmbedDecision.Fallback)
        assertEquals(EmbedDecision.Unavailable, decideEmbed(Platform.INSTAGRAM, OEmbedResult.Unavailable))
        assertEquals(EmbedDecision.Offline, decideEmbed(Platform.INSTAGRAM, OEmbedResult.Offline))
    }
}
