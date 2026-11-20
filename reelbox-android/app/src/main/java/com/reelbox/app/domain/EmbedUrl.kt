package com.reelbox.app.domain

import com.reelbox.app.data.Platform
import java.net.URLEncoder

/**
 * Public embed pages, the same ones behind "Embed" in Instagram's share menu and Facebook's embed plugin.
 * They need no API or app approval and show the creator, caption and thumbnail exactly as the platform does.
 */
object EmbedUrl {
    fun forReel(platform: Platform, permalink: String): String = when (platform) {
        Platform.INSTAGRAM -> permalink.trimEnd('/') + "/embed/captioned/"
        Platform.FACEBOOK -> "https://www.facebook.com/plugins/video.php?show_text=true&width=500&href=" + URLEncoder.encode(permalink, "UTF-8")
    }

    /** Only the embed itself may load inside the app; any other link opens in the browser. */
    fun isEmbedHost(url: String): Boolean {
        val host = runCatching { java.net.URI(url).host }.getOrNull()?.lowercase() ?: return false
        return host == "www.instagram.com" || host == "instagram.com" || host == "www.facebook.com" || host == "facebook.com" ||
            host == "static.xx.fbcdn.net" || host.endsWith(".cdninstagram.com") || host.endsWith(".fbcdn.net")
    }
}
