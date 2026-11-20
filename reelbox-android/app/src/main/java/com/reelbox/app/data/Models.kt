package com.reelbox.app.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

enum class Platform(val label: String) { INSTAGRAM("Instagram"), FACEBOOK("Facebook") }

enum class ReelStatus(val label: String) {
    NEW("New"), TO_TRY("To try"), TRIED("Tried"), DONE("Done"), ARCHIVED("Archived")
}

/** PENDING = waiting for enrichment (e.g. offline), ENRICHED = details fetched, MANUAL = fill in by hand. */
enum class EnrichState { PENDING, ENRICHED, MANUAL }

@Entity(tableName = "folders")
data class FolderEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val emoji: String,
    val parentId: Long? = null,
    val isSystem: Boolean = false,
)

@Entity(tableName = "reels", indices = [Index(value = ["normalizedUrl"], unique = true)])
data class ReelEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val permalink: String,
    val normalizedUrl: String,
    val platform: Platform,
    val platformId: String?,
    val title: String,
    val creatorHandle: String?,
    val creatorName: String?,
    val caption: String,
    val thumbnailUrl: String?,
    /** Comma-separated, lower-case, without '#'. */
    val hashtags: String,
    val audioName: String?,
    val status: ReelStatus,
    val folderId: Long,
    val note: String,
    val enrichState: EnrichState,
    val isUnavailable: Boolean,
    val createdAt: Long,
    val lastOpenedAt: Long?,
    /** Structured result from the AI step (see ReelAi), cached so unchanged text is never sent twice. */
    val aiJson: String? = null,
    val aiHash: String? = null,
    val likes: Long? = null,
    val comments: Long? = null,
    val views: Long? = null,
    /** Event date found in the text (or set by the user), as yyyy-MM-dd, and when to notify about it. */
    val eventDate: String? = null,
    val remindAt: Long? = null,
    /** True once the user removed the date, so automatic detection never puts it back. */
    @androidx.room.ColumnInfo(defaultValue = "0") val dateDismissed: Boolean = false,
) {
    val tagList: List<String> get() = hashtags.split(',').map { it.trim() }.filter { it.isNotEmpty() }
}

data class ReelWithFolder(val reel: ReelEntity, val folder: FolderEntity?)

val SYSTEM_FOLDERS: List<Pair<String, String>> = listOf(
    "Inbox" to "📥",
    "Recipes" to "🍛",
    "Travel" to "✈️",
    "Fashion" to "👗",
    "Home" to "🏠",
    "Motivation" to "💪",
    "To Try" to "✨",
)
const val INBOX = "Inbox"
const val NOTE_LIMIT = 500
