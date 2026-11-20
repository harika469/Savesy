package com.reelbox.app

import com.reelbox.app.data.Platform
import com.reelbox.app.domain.OEmbedClient
import com.reelbox.app.domain.OEmbedResult
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OEmbedClientTest {
    private lateinit var server: MockWebServer
    private lateinit var client: OEmbedClient
    private val reel = "https://www.instagram.com/reel/DeG_FtSJmIR/"
    private val html = """<blockquote class="instagram-media" data-instgrm-permalink="$reel">View this post on Instagram</blockquote>"""

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        client = OEmbedClient(baseUrl = server.url("/"))
    }

    @After fun tearDown() = runCatching { server.shutdown() }.let { }

    private fun reply(code: Int, body: String) = server.enqueue(MockResponse().setResponseCode(code).setBody(body))

    @Test fun instagramCallsInstagramOembedWithOnlyThePublicLink() = runBlocking {
        reply(200, """{"version":"1.0","type":"rich","html":${org.json.JSONObject.quote(html)}}""")
        val result = client.fetch(Platform.INSTAGRAM, reel)
        assertTrue(result is OEmbedResult.Success)
        assertEquals(html, (result as OEmbedResult.Success).html)

        val request = server.takeRequest()
        assertEquals("/v27.0/instagram_oembed", request.requestUrl!!.encodedPath)
        assertEquals(reel, request.requestUrl!!.queryParameter("url"))
        assertEquals("true", request.requestUrl!!.queryParameter("omitscript"))
    }

    @Test fun noTokenCookieOrIdentifierIsEverSent() = runBlocking {
        reply(200, """{"html":"<blockquote class=\"instagram-media\"></blockquote>"}""")
        client.fetch(Platform.INSTAGRAM, reel)
        val request = server.takeRequest()
        assertNull(request.getHeader("Authorization"))
        assertNull(request.getHeader("Cookie"))
        assertNull(request.requestUrl!!.queryParameter("access_token"))
        assertEquals(setOf("url", "omitscript"), request.requestUrl!!.queryParameterNames)
    }

    @Test fun facebookUsesTheVideoEndpoint() = runBlocking {
        reply(200, """{"html":"<div class=\"fb-video\"></div>"}""")
        client.fetch(Platform.FACEBOOK, "https://www.facebook.com/reel/987654")
        assertEquals("/v27.0/oembed_video", server.takeRequest().requestUrl!!.encodedPath)
    }

    @Test fun optionalFieldsAreReadWhenMetaSendsThem() = runBlocking {
        reply(200, """{"html":"<blockquote class=\"instagram-media\"></blockquote>","author_name":"purna_recipes","thumbnail_url":"https://cdn/x.jpg","title":"15 minute sabzi"}""")
        val r = client.fetch(Platform.INSTAGRAM, reel) as OEmbedResult.Success
        assertEquals("purna_recipes", r.authorName)
        assertEquals("https://cdn/x.jpg", r.thumbnailUrl)
        assertEquals("15 minute sabzi", r.title)
    }

    @Test fun htmlOnlyAnswerLeavesTheOptionalFieldsEmpty() = runBlocking {
        reply(200, """{"html":"<blockquote class=\"instagram-media\"></blockquote>"}""")
        val r = client.fetch(Platform.INSTAGRAM, reel) as OEmbedResult.Success
        assertNull(r.authorName); assertNull(r.thumbnailUrl); assertNull(r.title)
    }

    @Test fun privateOrDeletedPostsAreUnavailable() = runBlocking {
        reply(400, """{"error":{"message":"Unsupported get request","type":"GraphMethodException","code":100}}""")
        assertEquals(OEmbedResult.Unavailable, client.fetch(Platform.INSTAGRAM, reel))
        reply(404, "")
        assertEquals(OEmbedResult.Unavailable, client.fetch(Platform.INSTAGRAM, reel))
    }

    @Test fun rateLimitsAreRecognisedByStatusAndByGraphErrorCode() = runBlocking {
        reply(429, "")
        assertEquals(OEmbedResult.RateLimited, client.fetch(Platform.INSTAGRAM, reel))
        reply(400, """{"error":{"message":"Application request limit reached","code":4}}""")
        assertEquals(OEmbedResult.RateLimited, client.fetch(Platform.INSTAGRAM, reel))
    }

    @Test fun serverErrorsAndNoConnectionMeanOffline() = runBlocking {
        reply(503, "")
        assertEquals(OEmbedResult.Offline, client.fetch(Platform.INSTAGRAM, reel))
        server.shutdown()
        assertEquals(OEmbedResult.Offline, client.fetch(Platform.INSTAGRAM, reel))
    }

    @Test fun missingHtmlOrGarbageIsUnavailableNotACrash() = runBlocking {
        reply(200, """{"version":"1.0"}""")
        assertEquals(OEmbedResult.Unavailable, client.fetch(Platform.INSTAGRAM, reel))
        reply(200, "<html>nope</html>")
        assertEquals(OEmbedResult.Unavailable, client.fetch(Platform.INSTAGRAM, reel))
    }
}
