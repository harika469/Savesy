package com.reelbox.app.domain

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class Enrichment(
    val title: String?,
    val caption: String?,
    val creatorName: String?,
    val creatorHandle: String?,
    val thumbnailUrl: String?,
)

sealed interface EnrichResult {
    data class Success(val data: Enrichment) : EnrichResult
    /** Private, deleted or blocked reel. Don't retry; the user adds details by hand. */
    data object Unavailable : EnrichResult
    /** Public embed exists, but Meta did not return structured metadata. */
    data object DisplayOnly : EnrichResult
    /** No network or the service is down. Keep as pending and retry later. */
    data object Offline : EnrichResult
}

interface MetadataProvider {
    suspend fun enrich(link: ParsedLink): EnrichResult
}

/** Used when Supabase isn't configured: every reel is saved for manual details. */
object ManualProvider : MetadataProvider {
    override suspend fun enrich(link: ParsedLink): EnrichResult = EnrichResult.Unavailable
}

data class HttpResult(val code: Int, val body: String)

/** code 0 means the request never completed (no network, timeout). */
suspend fun httpPost(url: String, headers: Map<String, String>, body: String): HttpResult = withContext(Dispatchers.IO) {
    try {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 8000
            readTimeout = 30000
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
        }
        try {
            connection.outputStream.use { it.write(body.toByteArray()) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            HttpResult(code, stream?.bufferedReader()?.use { it.readText() }.orEmpty())
        } finally {
            connection.disconnect()
        }
    } catch (_: IOException) {
        HttpResult(0, "")
    }
}

/**
 * Reads whatever oEmbed returns about a reel through [OEmbedClient]. Meta's public oEmbed gives the embed HTML
 * (which the app renders, see EmbedView) and normally no separate creator, caption or thumbnail, so this provider
 * only succeeds when those fields are present; otherwise details come from the user's own text.
 */
class MetaOEmbedProvider(private val client: OEmbedClient = OEmbedClient()) : MetadataProvider {
    override suspend fun enrich(link: ParsedLink): EnrichResult = when (val result = client.fetch(link.platform, link.permalink)) {
        is OEmbedResult.Success -> {
            val author = result.authorName
            val caption = result.title
            if (author == null && caption == null && result.thumbnailUrl == null) EnrichResult.DisplayOnly
            else EnrichResult.Success(
                Enrichment(
                    title = caption?.lineSequence()?.firstOrNull()?.take(120),
                    caption = caption,
                    creatorName = author,
                    creatorHandle = author?.let { "@" + it.removePrefix("@") },
                    thumbnailUrl = result.thumbnailUrl,
                )
            )
        }
        OEmbedResult.Unavailable -> EnrichResult.Unavailable
        OEmbedResult.RateLimited, OEmbedResult.Offline -> EnrichResult.Offline
    }
}
