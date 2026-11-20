package com.reelbox.app

import com.reelbox.app.domain.EnrichResult
import com.reelbox.app.domain.HttpResult
import com.reelbox.app.domain.MetaOEmbedEnricher
import com.reelbox.app.domain.UrlParser
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MetaOEmbedEnricherTest {
    private val ig = UrlParser.parse("https://www.instagram.com/reel/Cabc123/?igsh=1")!!
    private val fb = UrlParser.parse("https://www.facebook.com/reel/987654")!!

    private fun enricher(result: HttpResult, seen: MutableList<String> = mutableListOf()) =
        MetaOEmbedEnricher(fetch = { url -> seen += url; result })

    @Test fun instagramUsesInstagramEndpointWithoutAnyToken() = runBlocking {
        val seen = mutableListOf<String>()
        enricher(HttpResult(200, """{"title":"Easy dinner #recipe","author_name":"foodie_harika","thumbnail_url":"https://cdn/x.jpg"}"""), seen).enrich(ig)
        assertEquals(1, seen.size)
        assertTrue(seen[0], seen[0].startsWith("https://graph.facebook.com/v26.0/instagram_oembed?url=https%3A%2F%2Fwww.instagram.com%2Freel%2FCabc123%2F"))
        assertTrue("no token must be sent", "access_token" !in seen[0])
    }

    @Test fun facebookUsesVideoEndpoint() = runBlocking {
        val seen = mutableListOf<String>()
        enricher(HttpResult(200, "{}"), seen).enrich(fb)
        assertTrue(seen[0], seen[0].contains("/oembed_video?url="))
    }

    @Test fun parsesAuthorCaptionAndThumbnail() = runBlocking {
        val r = enricher(HttpResult(200, """{"title":"Line one\nline two","author_name":"foodie_harika","thumbnail_url":"https://cdn/x.jpg"}""")).enrich(ig)
        val d = (r as EnrichResult.Success).data
        assertEquals("@foodie_harika", d.creatorHandle)
        assertEquals("Line one", d.title)
        assertEquals("Line one\nline two", d.caption)
        assertEquals("https://cdn/x.jpg", d.thumbnailUrl)
    }

    @Test fun missingFieldsAreTolerated() = runBlocking {
        val d = (enricher(HttpResult(200, """{"author_name":"@x"}""")).enrich(ig) as EnrichResult.Success).data
        assertEquals("@x", d.creatorHandle)
        assertEquals(null, d.title)
        assertEquals(null, d.thumbnailUrl)
    }

    @Test fun clientErrorsMeanPrivateOrUnavailable() = runBlocking {
        assertEquals(EnrichResult.Unavailable, enricher(HttpResult(400, """{"error":{"message":"Unsupported get request"}}""")).enrich(ig))
        assertEquals(EnrichResult.Unavailable, enricher(HttpResult(404, "")).enrich(ig))
    }

    @Test fun rateLimitNetworkAndServerErrorsAreRetriedLater() = runBlocking {
        assertEquals(EnrichResult.Offline, enricher(HttpResult(429, "")).enrich(ig))
        assertEquals(EnrichResult.Offline, enricher(HttpResult(0, "")).enrich(ig))
        assertEquals(EnrichResult.Offline, enricher(HttpResult(503, "")).enrich(ig))
    }

    @Test fun garbageBodyIsUnavailableNotACrash() = runBlocking {
        assertEquals(EnrichResult.Unavailable, enricher(HttpResult(200, "<html>nope</html>")).enrich(ig))
    }

    @Test fun tokenlessShellWithNoDetailsMeansManualEntry() = runBlocking {
        // What Meta really returned for a public reel without a token (Nov 2026): only an embed placeholder.
        val shell = """{"version":"1.0","provider_name":"Instagram","provider_url":"https://www.instagram.com/","type":"rich","width":658,"html":"<blockquote>View this post on Instagram</blockquote>"}"""
        assertEquals(EnrichResult.Unavailable, enricher(HttpResult(200, shell)).enrich(ig))
    }
}
