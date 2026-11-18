package com.reelbox.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.reelbox.app.ReelboxApp
import com.reelbox.app.data.CaptureResult
import com.reelbox.app.data.FolderEntity
import com.reelbox.app.data.ReelRepository
import com.reelbox.app.data.ReelStatus
import com.reelbox.app.data.ReelWithFolder
import com.reelbox.app.domain.ReelSearch
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
        val (saved, week, untried) = statsOf(all, System.currentTimeMillis())
        val shown = all.filter { (folderId == null || it.reel.folderId == folderId) && ReelSearch.matches(it, q) }
        HomeState(shown, saved, week, untried, folders, folderId, q)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeState(emptyList(), 0, 0, 0, emptyList(), null, ""))

    init {
        viewModelScope.launch {
            repo.ensureSystemFolders()
            repo.retryPending()
        }
    }

    fun setQuery(value: String) { query.value = value }
    fun selectFolder(id: Long?) { selectedFolder.value = id }

    fun addByLink(text: String) {
        viewModelScope.launch {
            when (val result = repo.capture(text)) {
                CaptureResult.Invalid -> message.value = "That doesn't look like an Instagram or Facebook reel link"
                is CaptureResult.Duplicate -> message.value = "Already saved in ${result.folder?.name ?: "Inbox"}"
                is CaptureResult.Saved -> {
                    message.value = "Saved to Inbox"
                    val outcome = repo.enrich(result.reel.id)
                    outcome?.folder?.let { message.value = "Saved to ${it.name}" }
                }
            }
        }
    }
}

class DetailViewModel(app: Application) : AndroidViewModel(app) {
    private val repo: ReelRepository = (app as ReelboxApp).repository
    val folders: StateFlow<List<FolderEntity>> = repo.observeFolders().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun observe(id: Long) = combine(repo.observeReel(id), folders) { reel, f -> reel?.let { ReelWithFolder(it, f.firstOrNull { x -> x.id == it.folderId }) } }
    fun status(id: Long, status: ReelStatus) = viewModelScope.launch { repo.setStatus(id, status) }
    fun move(id: Long, folderId: Long) = viewModelScope.launch { repo.moveToFolder(id, folderId) }
    fun note(id: Long, note: String) = viewModelScope.launch { repo.setNote(id, note) }
    fun title(id: Long, title: String) = viewModelScope.launch { repo.setTitle(id, title) }
    fun opened(id: Long) = viewModelScope.launch { repo.markOpened(id) }
    fun delete(id: Long) = viewModelScope.launch { repo.delete(id) }
}
