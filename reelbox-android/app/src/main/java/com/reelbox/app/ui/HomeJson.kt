package com.reelbox.app.ui

import com.reelbox.app.data.Platform
import com.reelbox.app.data.ReelWithFolder
import org.json.JSONArray
import org.json.JSONObject

/** Turns the home screen state into the JSON that assets/reelbox_home.js renders. Pure, so it can be unit-tested. */
object HomeJson {
    private val gradients = listOf(
        "#f97316" to "#ef4444", "#06b6d4" to "#3b82f6", "#ec4899" to "#a855f7",
        "#22c55e" to "#16a34a", "#f59e0b" to "#f97316", "#8b5cf6" to "#ec4899",
    )

    fun gradientIndex(id: Long): Int = (((id % gradients.size) + gradients.size) % gradients.size).toInt()

    fun showSamples(state: HomeState) = state.allCount == 0 && state.query.isBlank() && state.selectedFolderId == null

    fun build(state: HomeState, clipboardLink: String?): String {
        val samples = showSamples(state)
        val items: List<ReelWithFolder> = if (samples) SampleReels.items else state.reels

        val reels = JSONArray()
        items.forEachIndexed { index, item ->
            val reel = item.reel
            val (from, to) = gradients[if (samples) index % gradients.size else gradientIndex(reel.id)]
            reels.put(JSONObject().apply {
                put("id", reel.id)
                put("title", reel.title)
                put("meta", "${reel.creatorHandle ?: reel.platform.label} • ${item.folder?.name ?: "Inbox"}")
                put("tags", JSONArray(reel.tagList.take(3)))
                put("emoji", item.folder?.emoji ?: "🎬")
                put("from", from); put("to", to)
                put("badge", if (samples) "Sample" else if (reel.platform == Platform.INSTAGRAM) "IG" else "FB")
                put("sample", samples)
            })
        }

        val chips = JSONArray().apply {
            put(JSONObject().put("id", JSONObject.NULL).put("name", "All").put("active", state.selectedFolderId == null))
            state.folders.forEach { put(JSONObject().put("id", it.id).put("name", it.name).put("active", state.selectedFolderId == it.id)) }
        }

        val empty = when {
            samples || items.isNotEmpty() -> null
            state.allCount == 0 -> "Nothing saved here yet."
            else -> "No reels match that."
        }

        return JSONObject().apply {
            put("stats", JSONObject().put("saved", state.allCount).put("folders", state.folders.size).put("week", state.thisWeek))
            put("query", state.query)
            put("chips", chips)
            put("reels", reels)
            put("sample", samples)
            put("emptyMessage", empty ?: JSONObject.NULL)
            put("banner", clipboardLink?.let { JSONObject().put("link", it.removePrefix("https://").removePrefix("www.").take(48)) } ?: JSONObject.NULL)
        }.toString()
    }
}
