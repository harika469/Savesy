package com.reelbox.app.domain

import com.reelbox.app.data.Platform
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.jsoup.Jsoup
import java.io.IOException

/** Uses the supplied public embed document, not its scripts or private API endpoints. */
object CaptionedEmbedParser {
    private val contextPattern = Regex(""""contextJSON"\s*:\s*("(?:\\.|[^"\\])*")""")

    private fun JSONObject.string(key: String): String? =
        if (isNull(key)) null else optString(key).trim().takeIf { it.isNotEmpty() }

    private fun JSONObject.count(key: String): Long? =
        optJSONObject(key)?.optLong("count", -1)?.takeIf { it >= 0 }

    private fun image(value: String?): String? =
        value?.takeIf { EmbedPolicy.isAllowed(it) }

    fun parse(html: String, expectedId: String): Enrichment? {
        val media = contextPattern.findAll(html).mapNotNull { match ->
            runCatching {
                // Decode the outer JSON string, then parse the inner object.
                val wrapper = JSONObject("{\"value\":" + match.groupValues[1] + "}")
                JSONObject(wrapper.getString("value"))
                    .optJSONObject("gql_data")?.optJSONObject("shortcode_media")
            }.getOrNull()
        }.firstOrNull { it.string("shortcode") == expectedId }

        val doc = Jsoup.parse(html)
        val owner = media?.optJSONObject("owner")
        val username = owner?.string("username")
            ?: doc.selectFirst(".UsernameText")?.text()?.trim()?.takeIf { it.isNotEmpty() }
        val caption = media?.optJSONObject("edge_media_to_caption")?.optJSONArray("edges")
            ?.optJSONObject(0)?.optJSONObject("node")?.string("text")
            ?: doc.selectFirst(".Caption")?.clone()?.apply {
                select(".CaptionUsername, .CaptionComments, .CaptionCommentsExpand").remove()
            }?.wholeText()?.trim()?.takeIf { it.isNotEmpty() }
        val thumb = image(media?.string("display_url"))
            ?: image(doc.selectFirst("img.EmbeddedMediaImage")?.attr("src"))
        if (username == null && caption == null && thumb == null) return null
        // Without matching structured data, require a visible link for this exact shortcode.
        if (media == null && doc.select("a[href]").none {
                val raw = it.attr("href")
                UrlParser.parse(raw)?.let { parsed ->
                    parsed.platform == Platform.INSTAGRAM && parsed.platformId == expectedId
                } == true
            }) return null

        val music = media?.optJSONObject("clips_music_attribution_info")
        val artist = music?.string("artist_name")
        val track = music?.string("song_name")
        return Enrichment(
            title = caption?.let { com.reelbox.app.data.deriveTitle(it) },
            caption = caption,
            creatorName = owner?.string("full_name") ?: username,
            creatorHandle = username?.let { "@" + it.removePrefix("@") },
            thumbnailUrl = thumb,
            likes = media?.count("edge_liked_by"),
            comments = media?.count("edge_media_to_comment"),
            views = media?.optLong("video_view_count", -1)?.takeIf { it >= 0 },
            audioName = listOfNotNull(artist, track).joinToString(" · ").ifBlank { null },
        )
    }
}

/** Experimental development provider. No cookies, credentials, redirects or retries around a denial. */
class CaptionedEmbedProvider(
    private val fallback: MetadataProvider = MetaOEmbedProvider(),
    private val http: OkHttpClient = OEmbedClient.shared.newBuilder()
        .followRedirects(false).followSslRedirects(false).build(),
    private val baseUrl: HttpUrl = "https://www.instagram.com/".toHttpUrl(),
) : MetadataProvider {
    override suspend fun enrich(link: ParsedLink): EnrichResult {
        if (link.platform != Platform.INSTAGRAM) return fallback.enrich(link)
        val id = link.platformId?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{1,64}")) }
            ?: return EnrichResult.Unavailable
        val type = link.permalink.toHttpUrl().pathSegments.firstOrNull()
            ?.takeIf { it in setOf("reel", "p", "tv") } ?: return EnrichResult.Unavailable
        val url = baseUrl.newBuilder().addPathSegment(type).addPathSegment(id)
            .addPathSegment("embed").addPathSegment("captioned").addPathSegment("").build()
        val request = Request.Builder().url(url).header("Accept", "text/html").build()
        return try {
            withContext(Dispatchers.IO) {
                http.newCall(request).await().use { response ->
                    when {
                        response.code == 429 || response.code >= 500 -> EnrichResult.Offline
                        !response.isSuccessful -> EnrichResult.Unavailable
                        else -> {
                            // Bound decompressed data; do not send raw HTML to AI.
                            val source = response.body?.source() ?: return@use EnrichResult.DisplayOnly
                            if (source.request(MAX_HTML + 1)) return@use EnrichResult.DisplayOnly
                            val html = source.readUtf8()
                            CaptionedEmbedParser.parse(html, id)?.let { EnrichResult.Success(it) }
                                ?: EnrichResult.DisplayOnly
                        }
                    }
                }
            }
        } catch (_: IOException) {
            EnrichResult.Offline
        }
    }

    companion object {
        private const val MAX_HTML = 2_000_000L
    }
}
