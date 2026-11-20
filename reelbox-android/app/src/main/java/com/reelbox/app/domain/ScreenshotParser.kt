package com.reelbox.app.domain

/** One line of text found in a screenshot, with its position. */
data class OcrLine(val text: String, val top: Int, val left: Int = 0)

data class ScreenshotInfo(val handle: String?, val caption: String, val hashtags: List<String>, val audio: String?) {
    val isEmpty: Boolean get() = handle == null && caption.isBlank() && hashtags.isEmpty() && audio == null
}

/**
 * Turns the text read from a screenshot of an Instagram/Facebook reel into creator, caption, hashtags and
 * audio. Works from layout clues (the creator sits next to "Follow", the caption below it, the audio line
 * under that). OCR is imperfect, so every field is best effort and editable in the app.
 */
object ScreenshotParser {
    private val uiWords = setOf(
        "follow", "following", "reels", "reel", "like", "likes", "comment", "comments", "share", "send", "more", "save",
        "remix", "audio", "original", "sponsored", "suggested", "view", "views", "add", "story", "instagram", "facebook",
        "home", "search", "profile", "message", "messages", "ago", "now",
    )
    private val handleRegex = Regex("""^@?([A-Za-z0-9._]{3,30})$""")
    private val countRegex = Regex("""^[\d.,]+\s*[KkMm]?$""")
    private val followedHandle = Regex("""^@?([A-Za-z0-9._]{3,30})\s*[•·.\-|]?\s*(?:Follow|Following)\b.*$""", RegexOption.IGNORE_CASE)
    private val hashtagRegex = Regex("""#([\p{L}\p{N}_]+)""")
    private val moreSuffix = Regex("""\s*(?:…|\.{2,3})?\s*more\s*$""", RegexOption.IGNORE_CASE)

    private fun clean(text: String) = text.trim().trimStart('•', '·', ' ').trim()

    private fun looksLikeHandle(token: String): Boolean {
        val match = handleRegex.matchEntire(token) ?: return false
        val name = match.groupValues[1]
        return name.any { it.isLetter() } && !countRegex.matches(name) && name.lowercase() !in uiWords
    }

    private fun isAudio(text: String): Boolean {
        val lower = text.lowercase()
        return lower.contains("original audio") || text.startsWith("♫") || text.startsWith("♪")
    }

    fun parse(lines: List<OcrLine>, imageHeight: Int): ScreenshotInfo {
        val sorted = lines.map { it.copy(text = clean(it.text)) }.filter { it.text.isNotEmpty() }.sortedBy { it.top }
        val lowerHalf = imageHeight * 0.40

        val hashtags = sorted.flatMap { hashtagRegex.findAll(it.text).map { m -> m.groupValues[1].lowercase() }.toList() }.distinct()

        val audioLine = sorted.firstOrNull { isAudio(it.text) }
        val audio = audioLine?.text?.trimStart('♫', '♪', ' ')?.trim()?.take(80)?.ifEmpty { null }

        // 1) "creator · Follow" on one line, 2) a lone username in the lower half (reels), 3) near the top (posts).
        var handleIndex = sorted.indexOfFirst { followedHandle.matches(it.text) && looksLikeHandle(followedHandle.matchEntire(it.text)!!.groupValues[1]) }
        var handle = if (handleIndex >= 0) followedHandle.matchEntire(sorted[handleIndex].text)!!.groupValues[1] else null
        if (handle == null) {
            handleIndex = sorted.indexOfFirst { it.top >= lowerHalf && looksLikeHandle(it.text) }
            if (handleIndex < 0) handleIndex = sorted.indexOfFirst { it.top <= imageHeight * 0.15 && looksLikeHandle(it.text) }
            if (handleIndex >= 0) handle = handleRegex.matchEntire(sorted[handleIndex].text)!!.groupValues[1]
        }

        val candidates = sorted.filterIndexed { index, line ->
            index > handleIndex && line.top >= lowerHalf * (if (handle == null) 1.0 else 0.0) && !isAudio(line.text) &&
                !countRegex.matches(line.text) && line.text.length >= 3 &&
                line.text.lowercase().trim('.', '…', ' ') !in uiWords && !followedHandle.matches(line.text)
        }
        // The caption ends where the audio line begins.
        val audioTop = audioLine?.top ?: Int.MAX_VALUE
        val captionLines = candidates.filter { it.top < audioTop }.map { it.text }
        val caption = moreSuffix.replace(captionLines.joinToString(" ").trim(), "").trim()

        return ScreenshotInfo(handle?.let { "@$it" }, caption, hashtags, audio)
    }
}
