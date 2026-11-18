package com.reelbox.app.domain

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

interface ReelEnricher {
    suspend fun enrich(link: ParsedLink): EnrichResult
}

/** Used when Supabase isn't configured: every reel is saved for manual details. */
object NoEnricher : ReelEnricher {
    override suspend fun enrich(link: ParsedLink): EnrichResult = EnrichResult.Unavailable
}

/**
 * Calls the `oembed` Supabase Edge Function (see supabase/functions/oembed). The function holds the
 * Meta token, so no secrets are shipped in the app.
 */
class EdgeFunctionEnricher(private val baseUrl: String, private val anonKey: String) : ReelEnricher {
    override suspend fun enrich(link: ParsedLink): EnrichResult = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        try {
            val endpoint = "${baseUrl.trimEnd('/')}/functions/v1/oembed?url=" + URLEncoder.encode(link.permalink, "UTF-8")
            val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                connectTimeout = 6000
                readTimeout = 8000
                setRequestProperty("apikey", anonKey)
                setRequestProperty("Authorization", "Bearer $anonKey")
            }
            try {
                when (connection.responseCode) {
                    200 -> parse(connection.inputStream.bufferedReader().readText())
                    in 400..499 -> EnrichResult.Unavailable
                    else -> EnrichResult.Offline
                }
            } finally {
                connection.disconnect()
            }
        } catch (_: IOException) {
            EnrichResult.Offline
        } catch (_: Exception) {
            EnrichResult.Unavailable
        }
    }

    internal fun parse(body: String): EnrichResult {
        val json = JSONObject(body)
        val author = json.optString("author_name").takeIf { it.isNotBlank() }
        val caption = json.optString("title").takeIf { it.isNotBlank() }
        return EnrichResult.Success(
            Enrichment(
                title = caption?.lineSequence()?.firstOrNull()?.take(120),
                caption = caption,
                creatorName = author,
                creatorHandle = author?.let { "@" + it.removePrefix("@") },
                thumbnailUrl = json.optString("thumbnail_url").takeIf { it.isNotBlank() },
            )
        )
    }
}
