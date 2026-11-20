package com.reelbox.app.data

import com.reelbox.app.domain.Classifier
import com.reelbox.app.domain.Confidence
import com.reelbox.app.domain.EnrichResult
import com.reelbox.app.domain.ParsedLink
import com.reelbox.app.domain.ReelEnricher
import com.reelbox.app.domain.Suggestion
import com.reelbox.app.domain.UrlParser
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map

sealed interface CaptureResult {
    /** Saved immediately in Inbox; call [ReelRepository.enrich] to fetch details and auto-file. */
    data class Saved(val reel: ReelEntity, val link: ParsedLink) : CaptureResult
    data class Duplicate(val reel: ReelEntity, val folder: FolderEntity?) : CaptureResult
    data object Invalid : CaptureResult
}

data class EnrichOutcome(val reel: ReelEntity, val folder: FolderEntity?, val suggestion: Suggestion?)

class ReelRepository(
    private val db: AppDatabase,
    private val enricher: ReelEnricher,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val reels get() = db.reels()
    private val folders get() = db.folders()

    fun observeReels(): Flow<List<ReelWithFolder>> =
        combine(reels.observeAll(), folders.observeAll()) { reelList, folderList ->
            val byId = folderList.associateBy { it.id }
            reelList.map { ReelWithFolder(it, byId[it.folderId]) }
        }

    fun observeFolders(): Flow<List<FolderEntity>> = folders.observeAll()
    fun observeReel(id: Long): Flow<ReelEntity?> = reels.observe(id)
    suspend fun observeReelOnce(id: Long): ReelEntity? = reels.get(id)
    suspend fun getFolders(): List<FolderEntity> = folders.getAll()

    suspend fun ensureSystemFolders() {
        if (folders.getAll().isNotEmpty()) return
        SYSTEM_FOLDERS.forEach { (name, emoji) -> folders.insert(FolderEntity(name = name, emoji = emoji, isSystem = true)) }
    }

    /** Step 1 of capture: must be fast. Validates, de-duplicates and saves to Inbox. */
    suspend fun capture(sharedText: String): CaptureResult {
        val link = UrlParser.parse(sharedText) ?: return CaptureResult.Invalid
        reels.findByKey(link.key)?.let { existing ->
            return CaptureResult.Duplicate(existing, folders.getAll().firstOrNull { it.id == existing.folderId })
        }
        ensureSystemFolders()
        val inbox = folders.findByName(INBOX)!!
        // Anything the user shared besides the link (never the link's own tracking junk).
        val rawUrl = UrlParser.extractUrl(sharedText)
        val hint = if (rawUrl == null) "" else sharedText.replace(rawUrl, "").trim()
        val reel = ReelEntity(
            permalink = link.permalink,
            normalizedUrl = link.key,
            platform = link.platform,
            platformId = link.platformId,
            title = "${link.platform.label} reel",
            creatorHandle = null,
            creatorName = null,
            caption = hint.take(2000),
            thumbnailUrl = null,
            hashtags = Classifier.hashtags(hint).take(5).joinToString(","),
            audioName = null,
            status = ReelStatus.NEW,
            folderId = inbox.id,
            note = "",
            enrichState = EnrichState.PENDING,
            isUnavailable = false,
            createdAt = now(),
            lastOpenedAt = null,
        )
        val id = try {
            reels.insert(reel)
        } catch (_: android.database.sqlite.SQLiteConstraintException) {
            // Two shares of the same reel raced each other.
            val existing = reels.findByKey(link.key)!!
            return CaptureResult.Duplicate(existing, folders.getAll().firstOrNull { it.id == existing.folderId })
        }
        return CaptureResult.Saved(reel.copy(id = id), link)
    }

    /** Step 2 of capture: fetch details, auto-classify, and move out of Inbox when confident. */
    suspend fun enrich(reelId: Long): EnrichOutcome? {
        val reel = reels.get(reelId) ?: return null
        val link = UrlParser.parse(reel.permalink) ?: return null
        val result = enricher.enrich(link)
        val updated = when (result) {
            is EnrichResult.Offline -> return EnrichOutcome(reel, folders.getAll().firstOrNull { it.id == reel.folderId }, null)
            is EnrichResult.Unavailable -> reel.copy(enrichState = EnrichState.MANUAL)
            is EnrichResult.Success -> reel.copy(
                title = result.data.title ?: reel.title,
                caption = result.data.caption ?: reel.caption,
                creatorName = result.data.creatorName,
                creatorHandle = result.data.creatorHandle,
                thumbnailUrl = result.data.thumbnailUrl,
                enrichState = EnrichState.ENRICHED,
            )
        }
        val suggestion = Classifier.classify(updated.title, "${updated.caption} ${updated.note}")
        val target = folders.findByName(suggestion.folder)
        val inbox = folders.findByName(INBOX)
        // Only auto-move out of Inbox; never override a folder the user already chose.
        val moved = if (target != null && inbox != null && updated.folderId == inbox.id && suggestion.folder != INBOX) updated.copy(folderId = target.id) else updated
        val final = moved.copy(hashtags = (suggestion.tags).joinToString(",").ifEmpty { moved.hashtags })
        reels.update(final)
        return EnrichOutcome(final, folders.getAll().firstOrNull { it.id == final.folderId }, suggestion)
    }

    /**
     * "Say something and we organise it": the user's words (spoken or typed) become the note and title,
     * the classifier files the reel, and tags are added. Never overrides a folder the user chose.
     */
    suspend fun describe(reelId: Long, text: String): EnrichOutcome? {
        val reel = reels.get(reelId) ?: return null
        val said = text.trim().ifEmpty { return null }
        val note = (if (reel.note.isBlank()) said else reel.note + "\n" + said).take(NOTE_LIMIT)
        val title = if (reel.title == "${reel.platform.label} reel") deriveTitle(said) else reel.title
        val suggestion = Classifier.classify(title, "${reel.caption} $note")
        val inbox = folders.findByName(INBOX)
        val target = folders.findByName(suggestion.folder)
        val folderId = if (inbox != null && reel.folderId == inbox.id && target != null && suggestion.folder != INBOX) target.id else reel.folderId
        val tags = (reel.tagList + suggestion.tags).distinct().take(5)
        val updated = reel.copy(title = title, note = note, folderId = folderId, hashtags = tags.joinToString(","))
        reels.update(updated)
        return EnrichOutcome(updated, folders.getAll().firstOrNull { it.id == updated.folderId }, suggestion)
    }

    suspend fun isSaved(sharedText: String): Boolean {
        val link = UrlParser.parse(sharedText) ?: return false
        return reels.findByKey(link.key) != null
    }

    /** Offline queue: retry reels that were saved without a connection. */
    suspend fun retryPending() {
        reels.pending().forEach { enrich(it.id) }
    }

    suspend fun moveToFolder(reelId: Long, folderId: Long) = mutate(reelId) { it.copy(folderId = folderId) }
    suspend fun setStatus(reelId: Long, status: ReelStatus) = mutate(reelId) { it.copy(status = status) }
    suspend fun setNote(reelId: Long, note: String) = mutate(reelId) { it.copy(note = note.take(NOTE_LIMIT)) }
    suspend fun setTitle(reelId: Long, title: String) = mutate(reelId) { it.copy(title = title.trim().ifEmpty { it.title }) }
    suspend fun markOpened(reelId: Long) = mutate(reelId) { it.copy(lastOpenedAt = now()) }
    suspend fun markUnavailable(reelId: Long) = mutate(reelId) { it.copy(isUnavailable = true) }
    suspend fun delete(reelId: Long) { reels.get(reelId)?.let { reels.delete(it) } }

    private suspend fun mutate(id: Long, change: (ReelEntity) -> ReelEntity) {
        reels.get(id)?.let { reels.update(change(it)) }
    }
}

val Suggestion.isConfident: Boolean get() = confidence == Confidence.HIGH

/** First sentence of what the user said, capitalised and kept short enough for a card title. */
fun deriveTitle(said: String): String {
    val first = said.trim().split(Regex("[.!?\\n]")).first().trim()
    val short = if (first.length > 60) first.take(60).substringBeforeLast(' ', first.take(60)).trimEnd(',', ' ') + "…" else first
    return short.replaceFirstChar { it.uppercase() }.ifEmpty { "Saved reel" }
}
