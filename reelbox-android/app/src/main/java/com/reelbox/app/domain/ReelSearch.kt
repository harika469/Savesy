package com.reelbox.app.domain

import com.reelbox.app.data.ReelWithFolder
import java.text.Normalizer

/** Full-text, typo-tolerant search over caption, creator, tags, note, title and folder name. */
object ReelSearch {
    private val diacritics = Regex("\\p{InCombiningDiacriticalMarks}+")
    private val splitter = Regex("[^\\p{L}\\p{N}]+")

    fun fold(text: String): String =
        diacritics.replace(Normalizer.normalize(text.lowercase(), Normalizer.Form.NFD), "")

    fun matches(item: ReelWithFolder, query: String): Boolean {
        val tokens = fold(query).split(splitter).filter { it.isNotEmpty() }
        if (tokens.isEmpty()) return true
        val r = item.reel
        val haystack = fold(
            listOf(r.title, r.caption, r.creatorHandle, r.creatorName, r.hashtags.replace(',', ' '), r.note, item.folder?.name, r.platform.label)
                .filterNotNull().joinToString(" ")
        )
        val words = haystack.split(splitter).filter { it.isNotEmpty() }
        return tokens.all { token -> haystack.contains(token) || (token.length >= 5 && words.any { within1Edit(it, token) }) }
    }

    /** True when the strings differ by at most one insertion, deletion or substitution. */
    internal fun within1Edit(a: String, b: String): Boolean {
        if (kotlin.math.abs(a.length - b.length) > 1) return false
        var i = 0
        var j = 0
        var edits = 0
        while (i < a.length && j < b.length) {
            if (a[i] == b[j]) { i++; j++; continue }
            if (++edits > 1) return false
            when {
                a.length > b.length -> i++
                a.length < b.length -> j++
                else -> { i++; j++ }
            }
        }
        return edits + (a.length - i) + (b.length - j) <= 1
    }
}
