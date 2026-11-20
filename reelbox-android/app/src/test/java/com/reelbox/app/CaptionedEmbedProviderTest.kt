package com.reelbox.app

import com.reelbox.app.domain.CaptionedEmbedParser
import com.reelbox.app.domain.CaptionedEmbedProvider
import com.reelbox.app.domain.EnrichResult
import com.reelbox.app.domain.ManualProvider
import com.reelbox.app.domain.UrlParser
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CaptionedEmbedProviderTest {
    private val id = "DeG_FtSJmIR"
    private val link = UrlParser.parse("https://www.instagram.com/reel/$id/")!!
    private val caption = "Creamy sabzi recipe 😍\n\nIngredients:\n2 tbsp oil\n#sabzi"
    private val inner = JSONObject("""{"gql_data":{"shortcode_media":{"shortcode":"DeG_FtSJmIR","owner":{"username":"purna_recipes"},"display_url":"https://cdninstagram.com/image.jpg","edge_liked_by":{"count":18651},"edge_media_to_comment":{"count":32},"video_view_count":577109}}}""").apply {
        getJSONObject("gql_data").getJSONObject("shortcode_media").put("edge_media_to_caption",
            JSONObject().put("edges", org.json.JSONArray().put(JSONObject().put("node", JSONObject().put("text", caption)))))
    }
    private val html = "<html><script>{\"contextJSON\":" + JSONObject.quote(inner.toString()) + "}</script></html>"

    @Test fun parsesDoubleEncodedContext() {
        val data = CaptionedEmbedParser.parse(html, id)!!
        assertEquals(caption, data.caption)
        assertEquals("@purna_recipes", data.creatorHandle)
        assertEquals("https://cdninstagram.com/image.jpg", data.thumbnailUrl)
        assertEquals(18651L, data.likes!!)
        assertEquals(32L, data.comments!!)
        assertEquals(577109L, data.views!!)
    }

    @Test fun rejectsWrongPostAndLoginPage() {
        assertNull(CaptionedEmbedParser.parse(html, "different"))
        assertNull(CaptionedEmbedParser.parse("<html>Log in</html>", id))
    }

    @Test fun visibleHtmlFallback() {
        val markup = """<a href="https://www.instagram.com/reel/$id/">Original</a><span class="UsernameText">cook</span><div class="Caption"><a class="CaptionUsername">cook</a><br>Recipe<br>Ingredients<div class="CaptionComments">32 comments</div></div>"""
        val out = CaptionedEmbedParser.parse(markup, id)!!
        assertEquals("@cook", out.creatorHandle)
        assertTrue(out.caption!!.contains("Ingredients"))
        assertFalse(out.caption!!.contains("32 comments"))
    }

    @Test fun directGetUsesNoAuthenticationAndStopsAtDenial() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val provider = CaptionedEmbedProvider(fallback = ManualProvider, baseUrl = server.url("/"))
            server.enqueue(MockResponse().setBody(html))
            assertTrue(provider.enrich(link) is EnrichResult.Success)
            val request = server.takeRequest()
            assertEquals("GET", request.method)
            assertEquals("/reel/$id/embed/captioned/", request.path)
            assertNull(request.getHeader("Cookie"))
            assertNull(request.getHeader("Authorization"))
            server.enqueue(MockResponse().setResponseCode(403))
            assertEquals(EnrichResult.Unavailable, provider.enrich(link))
            server.enqueue(MockResponse().setResponseCode(429))
            assertEquals(EnrichResult.Offline, provider.enrich(link))
        }
    }
}
