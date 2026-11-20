package com.reelbox.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.reelbox.app.ReelboxApp
import com.reelbox.app.data.CaptureResult
import com.reelbox.app.data.FolderEntity
import com.reelbox.app.data.ReelRepository
import com.reelbox.app.data.ReelStatus
import com.reelbox.app.data.ScreenshotImporter
import com.reelbox.app.data.userMessage
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import com.reelbox.app.data.ThumbStore
import com.reelbox.app.data.ReelWithFolder
import com.reelbox.app.domain.ReelSearch
import com.reelbox.app.domain.UrlParser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class HomeViewModel(app: Application) : AndroidViewModel(app) {
    private val repo: ReelRepository = (app as ReelboxApp).repository
    private val query = MutableStateFlow("")
    private val selectedFolder = MutableStateFlow<Long?>(null)
    val message = MutableStateFlow<String?>(null)

    val state: StateFlow<HomeState> = combine(repo.observeReels(), repo.observeFolders(), query, selectedFolder) { all, folders, q, folderId ->
        val (saved, week) = statsOf(all, System.currentTimeMillis())
        val shown = all.filter { (folderId == null || it.reel.folderId == folderId) && ReelSearch.matches(it, q) }
        HomeState(shown, saved, week, visibleFolders(folders, all), folderId, q)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeState(emptyList(), 0, 0, emptyList(), null, ""))

    /** A reel link found on the clipboard that isn't saved yet (Android only lets the foreground app read it). */
    val clipboardLink = MutableStateFlow<String?>(null)
    private var dismissedClip: String? = null

    fun checkClipboard(text: String?) {
        viewModelScope.launch {
            val usable = text?.takeIf { UrlParser.parse(it) != null && it != dismissedClip && !repo.isSaved(it) }
            clipboardLink.value = usable
        }
    }

    fun dismissClipboard() { dismissedClip = clipboardLink.value; clipboardLink.value = null }

    fun saveClipboard(onSaved: (Long) -> Unit) {
        val text = clipboardLink.value ?: return
        dismissClipboard()
        addByLink(text, onSaved)
    }

    init {
        viewModelScope.launch {
            repo.ensureSystemFolders()
            repo.retryPending()
        }
    }

    fun setQuery(value: String) { query.value = value }
    fun selectFolder(id: Long?) { selectedFolder.value = id }

    fun addByLink(text: String, onSaved: (Long) -> Unit = {}) {
        viewModelScope.launch {
            when (val result = repo.capture(text)) {
                CaptureResult.Invalid -> message.value = "That doesn't look like an Instagram or Facebook reel link"
                is CaptureResult.Duplicate -> message.value = "Already saved in ${result.folder?.name ?: "Inbox"}"
                is CaptureResult.Saved -> {
                    repo.enrich(result.reel.id)
                    onSaved(result.reel.id)
                }
            }
        }
    }
}

class DetailViewModel(app: Application) : AndroidViewModel(app) {
    private val repo: ReelRepository = (app as ReelboxApp).repository
    val folders: StateFlow<List<FolderEntity>> = repo.observeFolders().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    private val thumbs = ThumbStore(app)
    private val importer = ScreenshotImporter(app, repo, thumbs)
    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages

    fun observe(id: Long) = combine(repo.observeReel(id), folders) { reel, f -> reel?.let { ReelWithFolder(it, f.firstOrNull { x -> x.id == it.folderId }) } }
    fun status(id: Long, status: ReelStatus) = viewModelScope.launch { repo.setStatus(id, status) }
    fun move(id: Long, folderId: Long) = viewModelScope.launch { repo.moveToFolder(id, folderId) }
    fun note(id: Long, note: String) = viewModelScope.launch { repo.setNote(id, note) }
    fun title(id: Long, title: String) = viewModelScope.launch { repo.setTitle(id, title) }
    fun opened(id: Long) = viewModelScope.launch { repo.markOpened(id) }
    fun delete(id: Long) = viewModelScope.launch { thumbs.delete(repo.delete(id)) }

    /** After new text arrives (spoken, pasted, scanned) the AI step runs on its own, once per unchanged text. */
    private suspend fun autoOrganise(id: Long) { repo.organiseWithAi(id).userMessage()?.let { _messages.emit(it) } }

    fun describe(id: Long, said: String) = viewModelScope.launch { repo.describe(id, said); autoOrganise(id) }

    fun screenshot(id: Long, uris: List<android.net.Uri>) {
        viewModelScope.launch {
            _messages.emit("Reading screenshot…")
            _messages.emit(importer.import(id, uris))
            autoOrganise(id)
        }
    }

    fun pasteCaption(id: Long, text: String) {
        viewModelScope.launch {
            val out = repo.setCaptionFromText(id, text)
            _messages.emit(if (out == null) "Nothing to paste" else "Caption saved (${text.trim().length} characters)")
            autoOrganise(id)
        }
    }

    /** The button: runs the AI step now and says what happened, including when nothing was sent. */
    fun organise(id: Long) {
        viewModelScope.launch {
            _messages.emit(when (val outcome = repo.organiseWithAi(id)) {
                is com.reelbox.app.data.OrganiseOutcome.Done -> if (outcome.fromCache) "Already organised: nothing changed" else "Organised with AI"
                com.reelbox.app.data.OrganiseOutcome.TooLittleText -> "Add a caption, a screenshot or a few words first."
                com.reelbox.app.data.OrganiseOutcome.NotConfigured -> "AI isn't set up in this build yet."
                else -> outcome.userMessage() ?: "Couldn't organise this one."
            })
        }
    }
}
