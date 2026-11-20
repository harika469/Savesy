package com.reelbox.app.domain

import com.reelbox.app.data.Platform
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

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
suspend fun httpGet(url: String): HttpResult = withContext(Dispatchers.IO) {
    try {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 6000
            readTimeout = 8000
            setRequestProperty("Accept", "application/json")
        }
        try {
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
 * Meta's oEmbed endpoints, called straight from the phone. Since June 2026 they work without an access
 * token, but a tested call (Nov 2026) returned ONLY an embed placeholder, with no title, author or
 * thumbnail, so this is currently not used by the app (see ReelboxApp). Kept for when a Meta token with
 * oEmbed Read access is available, which does return those fields.
 */
class MetaOEmbedProvider(
    private val apiVersion: String = "v26.0",
    private val fetch: suspend (String) -> HttpResult = ::httpGet,
) : MetadataProvider {
    override suspend fun enrich(link: ParsedLink): EnrichResult {
        val endpoint = if (link.platform == Platform.INSTAGRAM) "instagram_oembed" else "oembed_video"
        val url = "https://graph.facebook.com/$apiVersion/$endpoint?url=" + URLEncoder.encode(link.permalink, "UTF-8") + "&omitscript=true"
        val response = fetch(url)
        return when {
            response.code in 200..299 -> try { parse(response.body) } catch (_: Exception) { EnrichResult.Unavailable }
            // Network trouble, rate limit (429) or Meta outage: keep pending and retry later.
            response.code == 0 || response.code == 429 || response.code >= 500 -> EnrichResult.Offline
            else -> EnrichResult.Unavailable
        }
    }

    internal fun parse(body: String): EnrichResult {
        val json = JSONObject(body)
        val author = json.optString("author_name").takeIf { it.isNotBlank() }
        val caption = json.optString("title").takeIf { it.isNotBlank() }
        val thumbnail = json.optString("thumbnail_url").takeIf { it.isNotBlank() }
        // Without a token Meta returns only an embed placeholder. No details means manual entry.
        if (author == null && caption == null && thumbnail == null) return EnrichResult.Unavailable
        return EnrichResult.Success(
            Enrichment(
                title = caption?.lineSequence()?.firstOrNull()?.take(120),
                caption = caption,
                creatorName = author,
                creatorHandle = author?.let { "@" + it.removePrefix("@") },
                thumbnailUrl = thumbnail,
            )
        )
    }
}
