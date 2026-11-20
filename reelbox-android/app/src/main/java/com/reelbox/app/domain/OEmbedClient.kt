package com.reelbox.app.domain

import com.reelbox.app.data.Platform
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

sealed interface OEmbedResult {
    /** [html] is Meta's embed markup. The other fields are only present when Meta sends them. */
    data class Success(val html: String, val authorName: String?, val thumbnailUrl: String?, val title: String?) : OEmbedResult
    /** Private, deleted or not an embeddable public post (HTTP 4xx from Meta). */
    data object Unavailable : OEmbedResult
    data object RateLimited : OEmbedResult
    /** No network, a timeout or a Meta outage. Worth retrying later. */
    data object Offline : OEmbedResult
}

/**
 * Meta's public oEmbed endpoints (`instagram_oembed`, `oembed_video`), called with OkHttp.
 * Since 15 June 2026 these need no access token and no App Review for public content, so this class never
 * sends a token, a cookie or any user identifier: only the public reel link.
 */
class OEmbedClient(
    private val http: OkHttpClient = shared,
    private val baseUrl: HttpUrl = "https://graph.facebook.com/".toHttpUrl(),
    private val version: String = "v27.0",
) {
    suspend fun fetch(platform: Platform, permalink: String): OEmbedResult {
        val endpoint = if (platform == Platform.INSTAGRAM) "instagram_oembed" else "oembed_video"
        val url = baseUrl.newBuilder()
            .addPathSegment(version).addPathSegment(endpoint)
            .addQueryParameter("url", permalink)
            .addQueryParameter("omitscript", "true") // the app adds the platform script itself, under its own rules
            .build()
        val request = Request.Builder().url(url).header("Accept", "application/json").build()
        return try {
            http.newCall(request).await().use { response ->
                val body = response.body?.string().orEmpty()
                when {
                    response.isSuccessful -> parse(body)
                    response.code == 429 || isRateLimitError(body) -> OEmbedResult.RateLimited
                    response.code >= 500 -> OEmbedResult.Offline
                    else -> OEmbedResult.Unavailable
                }
            }
        } catch (_: IOException) {
            OEmbedResult.Offline
        }
    }

    internal fun parse(body: String): OEmbedResult = try {
        val json = JSONObject(body)
        val html = json.optString("html").trim()
        if (html.isEmpty()) OEmbedResult.Unavailable
        else OEmbedResult.Success(
            html = html,
            authorName = json.optString("author_name").takeIf { it.isNotBlank() },
            thumbnailUrl = json.optString("thumbnail_url").takeIf { it.isNotBlank() },
            title = json.optString("title").takeIf { it.isNotBlank() },
        )
    } catch (_: Exception) {
        OEmbedResult.Unavailable
    }

    /** Graph API error codes for "too many calls" (4, 17, 32, 341, 613). */
    private fun isRateLimitError(body: String): Boolean = try {
        JSONObject(body).optJSONObject("error")?.optInt("code") in setOf(4, 17, 32, 341, 613)
    } catch (_: Exception) { false }

    companion object {
        val shared: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(6, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).callTimeout(12, TimeUnit.SECONDS)
                .build()
        }
    }
}

internal suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) = cont.resume(response)
        override fun onFailure(call: Call, e: IOException) = cont.resumeWithException(e)
    })
    cont.invokeOnCancellation { cancel() }
}
