package com.reelbox.app.ui

import com.reelbox.app.data.EnrichState
import com.reelbox.app.data.FolderEntity
import com.reelbox.app.data.Platform
import com.reelbox.app.data.ReelEntity
import com.reelbox.app.data.ReelStatus
import com.reelbox.app.data.ReelWithFolder

/**
 * Shown only while the library is empty, so a new install looks like the Reelbox design instead of a blank page.
 * They are never saved, never counted in the stats, and disappear as soon as a real reel is saved.
 */
object SampleReels {
    private data class Sample(val title: String, val creator: String, val folder: String, val emoji: String, val tags: String)

    private val samples = listOf(
        Sample("15-min Paneer Butter Masala", "@foodie_harika", "Recipes", "🍛", "recipe,dinner"),
        Sample("Hidden Cafe in Amsterdam", "@wanderlust", "Travel", "☕", "amsterdam,cafe"),
        Sample("GRWM - Wedding Outfit", "@style_diary", "Fashion", "👗", "grwm,wedding"),
        Sample("15-min Home Workout", "@fit_daily", "Home", "💪", "workout"),
        Sample("Small Balcony Makeover", "@home.inspo", "Home", "🏠", "decor"),
        Sample("Hair Oiling Routine", "@glowup", "Fashion", "💇‍♀️", "haircare"),
    )

    val items: List<ReelWithFolder> = samples.mapIndexed { index, s ->
        val id = -(index + 1).toLong()
        ReelWithFolder(
            ReelEntity(
                id = id, permalink = "", normalizedUrl = "sample:$id", platform = Platform.INSTAGRAM, platformId = null,
                title = s.title, creatorHandle = s.creator, creatorName = null, caption = "", thumbnailUrl = null,
                hashtags = s.tags, audioName = null, status = ReelStatus.NEW, folderId = id, note = "",
                enrichState = EnrichState.ENRICHED, isUnavailable = false, createdAt = 0, lastOpenedAt = null,
            ),
            FolderEntity(id, s.folder, s.emoji),
        )
    }

    fun isSample(id: Long) = id < 0
}
