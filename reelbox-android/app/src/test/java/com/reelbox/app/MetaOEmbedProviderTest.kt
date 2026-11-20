package com.reelbox.app

import com.reelbox.app.domain.EnrichResult
import com.reelbox.app.domain.MetaOEmbedProvider
import com.reelbox.app.domain.OEmbedClient
import com.reelbox.app.domain.UrlParser
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MetaOEmbedProviderTest {
    private lateinit var server: MockWebServer
    private lateinit var provider: MetaOEmbedProvider
    private val link = UrlParser.parse("https://www.instagram.com/reel/Cabc123/?igsh=1")!!

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        provider = MetaOEmbedProvider(OEmbedClient(baseUrl = server.url("/")))
    }

    @After fun tearDown() = runCatching { server.shutdown() }.let { }

    private fun reply(code: Int, body: String) = server.enqueue(MockResponse().setResponseCode(code).setBody(body))

    @Test fun detailsAreUsedWhenMetaSendsThem() = runBlocking {
        reply(200, """{"html":"<blockquote class=\"instagram-media\"></blockquote>","title":"Line one\nline two","author_name":"foodie_harika","thumbnail_url":"https://cdn/x.jpg"}""")
        val data = (provider.enrich(link) as EnrichResult.Success).data
        assertEquals("@foodie_harika", data.creatorHandle)
        assertEquals("Line one", data.title)
        assertEquals("https://cdn/x.jpg", data.thumbnailUrl)
    }

    @Test fun htmlOnlyAnswerGivesNoDetailsSoTheUserSuppliesThem() = runBlocking {
        reply(200, """{"html":"<blockquote class=\"instagram-media\"></blockquote>"}""")
        assertEquals(EnrichResult.DisplayOnly, provider.enrich(link))
    }

    @Test fun errorsMapToTheRightOutcome() = runBlocking {
        reply(400, """{"error":{"code":100}}""")
        assertEquals(EnrichResult.Unavailable, provider.enrich(link))
        reply(429, "")
        assertEquals(EnrichResult.Offline, provider.enrich(link))
        reply(500, "")
        assertTrue(provider.enrich(link) is EnrichResult.Offline)
    }
}
