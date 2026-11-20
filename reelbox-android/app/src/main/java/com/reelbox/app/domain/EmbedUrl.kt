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

    /** Kept for callers of the old name: the rules now live in [EmbedPolicy]. */
    fun isEmbedHost(url: String): Boolean = EmbedPolicy.isAllowed(url)
}
