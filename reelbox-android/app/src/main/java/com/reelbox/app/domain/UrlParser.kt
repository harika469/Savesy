package com.reelbox.app.domain

import com.reelbox.app.data.Platform
import java.net.URI
import java.net.URLDecoder

data class ParsedLink(
    val platform: Platform,
    val platformId: String?,
    /** Clean link without tracking parameters; this is what we open and store. */
    val permalink: String,
    /** Stable key used to detect duplicates, e.g. "ig:Cxyz123". */
    val key: String,
)

/** Accepts what Instagram / Facebook put in a share intent and turns it into a [ParsedLink]. */
object UrlParser {
    private val urlRegex = Regex("""https?://[^\s<>"']+""", RegexOption.IGNORE_CASE)
    private val igHosts = setOf("instagram.com", "instagr.am")
    private val fbHosts = setOf("facebook.com", "fb.com", "fb.watch")

    fun extractUrl(text: String): String? =
        urlRegex.find(text)?.value?.trimEnd('.', ',', ')', '!', '?', ';')

    fun parse(text: String): ParsedLink? {
        val raw = extractUrl(text) ?: return null
        val uri = try { URI(raw) } catch (_: Exception) { return null }
        val host = uri.host?.lowercase()?.removePrefix("www.")?.removePrefix("m.")?.removePrefix("web.") ?: return null
        val segments = (uri.path ?: "").split('/').filter { it.isNotEmpty() }
        return when {
            host in igHosts -> parseInstagram(segments)
            host == "fb.watch" -> segments.firstOrNull()?.let {
                ParsedLink(Platform.FACEBOOK, it, "https://fb.watch/$it/", "fb:short:$it")
            }
            host in fbHosts -> parseFacebook(segments, uri.rawQuery)
            else -> null
        }
    }

    private fun parseInstagram(segments: List<String>): ParsedLink? {
        val types = setOf("reel", "reels", "p", "tv")
        val index = segments.indexOfFirst { it in types }
        val id = segments.getOrNull(index + 1)?.takeIf { index >= 0 && it.isNotBlank() } ?: return null
        // "reels/<id>" is the same content as "reel/<id>".
        val type = if (segments[index] == "reels") "reel" else segments[index]
        return ParsedLink(Platform.INSTAGRAM, id, "https://www.instagram.com/$type/$id/", "ig:$id")
    }

    private fun parseFacebook(segments: List<String>, rawQuery: String?): ParsedLink? {
        val reelAt = segments.indexOf("reel")
        if (reelAt >= 0) segments.getOrNull(reelAt + 1)?.let {
            return ParsedLink(Platform.FACEBOOK, it, "https://www.facebook.com/reel/$it", "fb:$it")
        }
        val videosAt = segments.indexOf("videos")
        if (videosAt >= 0) segments.getOrNull(videosAt + 1)?.takeIf { it.all(Char::isDigit) }?.let {
            return ParsedLink(Platform.FACEBOOK, it, "https://www.facebook.com/watch/?v=$it", "fb:$it")
        }
        if (segments.firstOrNull() == "watch") {
            queryParam(rawQuery, "v")?.takeIf { it.isNotBlank() }?.let {
                return ParsedLink(Platform.FACEBOOK, it, "https://www.facebook.com/watch/?v=$it", "fb:$it")
            }
        }
        if (segments.firstOrNull() == "share" && segments.size >= 3 && segments[1] in setOf("r", "v")) {
            val code = segments[2]
            return ParsedLink(Platform.FACEBOOK, code, "https://www.facebook.com/share/${segments[1]}/$code/", "fb:share:$code")
        }
        return null
    }

    private fun queryParam(rawQuery: String?, name: String): String? =
        rawQuery?.split('&')?.map { it.split('=', limit = 2) }
            ?.firstOrNull { it[0] == name }?.getOrNull(1)
            ?.let { URLDecoder.decode(it, "UTF-8") }
}
