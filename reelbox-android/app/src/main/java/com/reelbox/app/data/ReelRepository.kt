package com.reelbox.app.data

import com.reelbox.app.domain.Classifier
import com.reelbox.app.domain.Confidence
import com.reelbox.app.domain.EnrichResult
import com.reelbox.app.domain.ParsedLink
import com.reelbox.app.domain.ScreenshotInfo
import com.reelbox.app.domain.AiOrganiser
import com.reelbox.app.domain.AiResult
import com.reelbox.app.domain.MetadataProvider
import com.reelbox.app.domain.NoAiOrganiser
import com.reelbox.app.domain.ReelAi
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

sealed interface OrganiseOutcome {
    data class Done(val reel: ReelEntity, val fromCache: Boolean) : OrganiseOutcome
    /** Not enough text to be worth an AI call: the user keeps organising by hand. */
    data object TooLittleText : OrganiseOutcome
    data object NotConfigured : OrganiseOutcome
    data object LimitReached : OrganiseOutcome
    data object Offline : OrganiseOutcome
    data class Failed(val reason: String) : OrganiseOutcome
}

const val MIN_AI_TEXT = 20
private const val MAX_AI_TEXT = 6000

data class EnrichOutcome(val reel: ReelEntity, val folder: FolderEntity?, val suggestion: Suggestion?)

class ReelRepository(
    private val db: AppDatabase,
    private val enricher: MetadataProvider,
    private val now: () -> Long = System::currentTimeMillis,
    private val ai: AiOrganiser = NoAiOrganiser,
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
            title = if (hint.isBlank()) "${link.platform.label} reel" else deriveTitle(hint),
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
        val original = reels.get(reelId) ?: return null
        val link = UrlParser.parse(original.permalink) ?: return null
        val result = enricher.enrich(link)
        // Re-read after the network call so edits made while loading are preserved.
        val reel = reels.get(reelId) ?: return null
        val updated = when (result) {
            is EnrichResult.Offline -> return EnrichOutcome(reel, folders.getAll().firstOrNull { it.id == reel.folderId }, null)
            is EnrichResult.Unavailable, EnrichResult.DisplayOnly -> reel.copy(enrichState = if (reel.enrichState == EnrichState.ENRICHED) EnrichState.ENRICHED else EnrichState.MANUAL)
            is EnrichResult.Success -> reel.copy(
                title = if (reel.title == "${reel.platform.label} reel") result.data.title ?: reel.title else reel.title,
                caption = reel.caption.ifBlank { result.data.caption.orEmpty() },
                creatorName = reel.creatorName ?: result.data.creatorName,
                creatorHandle = reel.creatorHandle ?: result.data.creatorHandle,
                thumbnailUrl = reel.thumbnailUrl ?: result.data.thumbnailUrl,
                enrichState = EnrichState.ENRICHED,
            )
        }
        val suggestion = Classifier.classify(updated.title, "${updated.caption} ${updated.note}")
        val target = folders.findByName(suggestion.folder)
        val inbox = folders.findByName(INBOX)
        // Only auto-move out of Inbox; never override a folder the user already chose.
        val moved = if (target != null && inbox != null && updated.folderId == inbox.id && suggestion.folder != INBOX) updated.copy(folderId = target.id) else updated
        val final = moved.copy(hashtags = (moved.tagList + suggestion.tags).distinct().take(5).joinToString(","))
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

    /** Fills a reel from a screenshot the user took of it (creator, caption, hashtags, audio, thumbnail). */
    suspend fun applyScreenshot(reelId: Long, info: ScreenshotInfo, thumbnailUrl: String?): EnrichOutcome? {
        val reel = reels.get(reelId) ?: return null
        if (info.isEmpty && thumbnailUrl == null) return null
        val caption = info.caption.ifBlank { reel.caption }
        val title = if (reel.title == "${reel.platform.label} reel" && caption.isNotBlank()) deriveTitle(caption) else reel.title
        val hashtagText = info.hashtags.joinToString(" ") { "#$it" }
        val suggestion = Classifier.classify(title, "$caption ${reel.note} $hashtagText")
        val inbox = folders.findByName(INBOX)
        val target = folders.findByName(suggestion.folder)
        val folderId = if (inbox != null && reel.folderId == inbox.id && target != null && suggestion.folder != INBOX) target.id else reel.folderId
        val tags = (info.hashtags + suggestion.tags + reel.tagList).distinct().take(5)
        val updated = reel.copy(
            title = title,
            caption = caption,
            creatorHandle = info.handle ?: reel.creatorHandle,
            audioName = info.audio ?: reel.audioName,
            thumbnailUrl = thumbnailUrl ?: reel.thumbnailUrl,
            hashtags = tags.joinToString(","),
            folderId = folderId,
            enrichState = EnrichState.ENRICHED,
        )
        reels.update(updated)
        return EnrichOutcome(updated, folders.getAll().firstOrNull { it.id == updated.folderId }, suggestion)
    }

    /** The exact caption copied from Instagram/Facebook. Replaces the caption, then tags and files the reel. */
    suspend fun setCaptionFromText(reelId: Long, text: String): EnrichOutcome? {
        val caption = text.trim().ifEmpty { return null }
        return applyScreenshot(reelId, ScreenshotInfo(null, caption, Classifier.hashtags(caption), null), null)
    }

    /**
     * AI step: sends only text the user supplied (caption, scanned text, note), never the video or link.
     * The result is cached on the reel and keyed by a hash of the input, so unchanged text costs nothing.
     */
    suspend fun organiseWithAi(reelId: Long, force: Boolean = false): OrganiseOutcome {
        val reel = reels.get(reelId) ?: return OrganiseOutcome.Failed("Reel not found")
        val text = listOf(reel.caption, reel.note).filter { it.isNotBlank() }.joinToString("\n\n").take(MAX_AI_TEXT)
        if (text.length < MIN_AI_TEXT) return OrganiseOutcome.TooLittleText
        val folderNames = folders.getAll().map { it.name }
        val hash = sha256("$text|${folderNames.joinToString(",")}")
        if (!force && reel.aiHash == hash && reel.aiJson != null) return OrganiseOutcome.Done(reel, fromCache = true)

        return when (val result = ai.organise(text, reel.creatorHandle, folderNames)) {
            AiResult.NotConfigured -> OrganiseOutcome.NotConfigured
            AiResult.LimitReached -> OrganiseOutcome.LimitReached
            AiResult.Offline -> OrganiseOutcome.Offline
            is AiResult.Failed -> OrganiseOutcome.Failed(result.reason)
            is AiResult.Success -> {
                val data = result.ai
                val inbox = folders.findByName(INBOX)
                val target = folders.findByName(data.category)
                val folderId = if (inbox != null && reel.folderId == inbox.id && target != null && data.category != INBOX) target.id else reel.folderId
                // Replace the title only when it is still a placeholder or the automatic one, never one the user typed.
                val autoTitle = deriveTitle(reel.caption.ifBlank { reel.note })
                val title = if (data.title.isNotBlank() && (reel.title == "${reel.platform.label} reel" || reel.title == autoTitle)) data.title else reel.title
                val updated = reel.copy(
                    title = title,
                    folderId = folderId,
                    hashtags = (data.tags + reel.tagList).distinct().take(5).joinToString(","),
                    aiJson = data.toJson(),
                    aiHash = hash,
                )
                reels.update(updated)
                OrganiseOutcome.Done(updated, fromCache = false)
            }
        }
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
    suspend fun markUnavailable(reelId: Long) = setUnavailable(reelId, true)
    /** Instagram/Facebook said the post can't be shown (private or removed). Notes and tags are kept; reversible. */
    suspend fun setUnavailable(reelId: Long, value: Boolean) = mutate(reelId) { if (it.isUnavailable == value) it else it.copy(isUnavailable = value) }
    /** @return the deleted reel's thumbnail url so the caller can remove the stored image. */
    suspend fun delete(reelId: Long): String? = reels.get(reelId)?.let { reels.delete(it); it.thumbnailUrl }

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

private fun sha256(text: String): String =
    java.security.MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

/** Parsed AI result for a reel, if one has been generated. */
val ReelEntity.ai: ReelAi? get() = aiJson?.let(ReelAi::fromJson)

/** Short note to show after an automatic AI run; null when there is nothing worth telling the user. */
fun OrganiseOutcome.userMessage(): String? = when (this) {
    is OrganiseOutcome.Done -> if (fromCache) null else "Organised with AI"
    OrganiseOutcome.LimitReached -> "Today's AI limit is used up. You can still organise by hand."
    OrganiseOutcome.Offline -> "No connection for AI. Try again later."
    is OrganiseOutcome.Failed -> "AI couldn't organise this one."
    OrganiseOutcome.NotConfigured, OrganiseOutcome.TooLittleText -> null
}
