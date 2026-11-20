package com.reelbox.app.domain

import com.reelbox.app.data.Platform

/** What a reel's embed WebView is allowed to load and open. Pure rules so they can be unit-tested. */
object EmbedPolicy {
    private val allowedDomains = listOf("instagram.com", "cdninstagram.com", "facebook.com", "facebook.net", "fbcdn.net")

    /** HTTPS only, and only Instagram / Facebook hosts (exact or a real subdomain, never a look-alike). */
    fun isAllowed(url: String): Boolean {
        val uri = runCatching { java.net.URI(url) }.getOrNull() ?: return false
        if (uri.scheme != "https") return false
        val host = uri.host?.lowercase() ?: return false
        return allowedDomains.any { host == it || host.endsWith(".$it") }
    }

    /** Sub-resources inside the page: the same hosts, plus the harmless in-page schemes the embed uses. */
    fun isAllowedResource(url: String): Boolean = isAllowed(url) || url == "about:blank" || url.startsWith("data:image/")

    /** Links that leave the embed (profile, "view on Instagram", ads) open in the browser, and only if HTTPS. */
    fun mayOpenExternally(url: String): Boolean = runCatching { java.net.URI(url).scheme == "https" }.getOrDefault(false)
}

/**
 * Meta's embed markup arrives as HTML from the network, so it is cleaned before it touches a WebView: scripts,
 * inline event handlers and javascript: links are removed, and the page is built from our own template
 * with a strict Content-Security-Policy and only the official platform script.
 */
object EmbedHtml {
    private val scriptTag = Regex("<script\\b[\\s\\S]*?</script\\s*>|<script\\b[^>]*/>", RegexOption.IGNORE_CASE)
    private val eventAttribute = Regex("""\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""", RegexOption.IGNORE_CASE)
    private val scriptUrl = Regex("""\s+(?:href|src|action|formaction)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')""", RegexOption.IGNORE_CASE)

    /** The cleaned markup, or null if it doesn't look like an embed for this platform. */
    fun sanitize(platform: Platform, html: String): String? {
        val cleaned = html.replace(scriptTag, "").replace(eventAttribute, "").replace(scriptUrl, "").trim()
        val recognised = when (platform) {
            Platform.INSTAGRAM -> cleaned.contains("instagram-media")
            Platform.FACEBOOK -> listOf("fb-video", "fb-post", "fb-xfbml-parse-ignore").any { cleaned.contains(it) }
        }
        return cleaned.takeIf { recognised }
    }

    fun baseUrl(platform: Platform) = if (platform == Platform.INSTAGRAM) "https://www.instagram.com/" else "https://www.facebook.com/"

    fun page(platform: Platform, safeHtml: String): String {
        val script = if (platform == Platform.INSTAGRAM) "https://www.instagram.com/embed.js"
        else "https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v27.0"
        val csp = "default-src 'none'; script-src https://www.instagram.com https://connect.facebook.net; " +
            "frame-src https://*.instagram.com https://instagram.com https://*.facebook.com; " +
            "img-src https: data:; media-src https:; font-src https: data:; style-src 'unsafe-inline' https:; " +
            "connect-src https://*.instagram.com https://*.facebook.com https://*.cdninstagram.com; base-uri 'none'; form-action 'none'"
        return """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="$csp">
<style>body{margin:0;padding:0 0 16px;background:#fff}</style></head>
<body><div id="fb-root"></div>$safeHtml<script async defer src="$script"></script></body></html>"""
    }
}

/** What the screen should do with Meta's answer. */
sealed interface EmbedDecision {
    data class Show(val page: String) : EmbedDecision
    /** Use the plain embed page instead, with a short reason for the user. */
    data class Fallback(val note: String) : EmbedDecision
    data object Unavailable : EmbedDecision
    data object Offline : EmbedDecision
}

fun decideEmbed(platform: Platform, result: OEmbedResult): EmbedDecision = when (result) {
    is OEmbedResult.Success -> EmbedHtml.sanitize(platform, result.html)
        ?.let { EmbedDecision.Show(EmbedHtml.page(platform, it)) }
        ?: EmbedDecision.Fallback("Couldn't read ${platform.label}'s answer. Showing the basic view.")
    OEmbedResult.RateLimited -> EmbedDecision.Fallback("${platform.label} is limiting requests right now. Showing the basic view.")
    OEmbedResult.Unavailable -> EmbedDecision.Unavailable
    OEmbedResult.Offline -> EmbedDecision.Offline
}
