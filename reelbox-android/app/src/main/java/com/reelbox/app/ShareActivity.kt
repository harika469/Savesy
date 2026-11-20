package com.reelbox.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import com.reelbox.app.data.CaptureResult
import com.reelbox.app.data.EnrichState
import com.reelbox.app.data.ReelRepository
import com.reelbox.app.data.ScreenshotImporter
import com.reelbox.app.data.userMessage
import com.reelbox.app.ui.CaptureSheet
import com.reelbox.app.ui.CaptureUi
import com.reelbox.app.ui.ReelboxTheme
import kotlinx.coroutines.launch

/**
 * Receives Instagram / Facebook "Share → Reelbox". Saves instantly, then fetches details and
 * auto-files while the bottom card is showing. Works even if the main app was never opened.
 */
class ShareActivity : ComponentActivity() {
    private lateinit var repo: ReelRepository
    private var reelId: Long? = null
    private val importer by lazy { ScreenshotImporter(this, repo) }
    private val ui = mutableStateOf<CaptureUi>(CaptureUi.Saving)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repo = (application as ReelboxApp).repository
        val shared = intent?.takeIf { it.action == Intent.ACTION_SEND }?.getStringExtra(Intent.EXTRA_TEXT).orEmpty()

        setContent {
            ReelboxTheme {
                val folders by remember { repo.observeFolders() }.collectAsState(initial = emptyList())
                Box(
                    Modifier.fillMaxSize().clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { finish() },
                    contentAlignment = Alignment.BottomCenter,
                ) {
                    CaptureSheet(
                        state = ui.value,
                        folders = folders,
                        onChangeFolder = { folderId ->
                            reelId?.let { id -> lifecycleScope.launch { repo.moveToFolder(id, folderId); refresh(id) } }
                        },
                        onDescribe = { said ->
                            reelId?.let { id ->
                                lifecycleScope.launch {
                                    repo.describe(id, said)?.let { outcome ->
                                        ui.value = CaptureUi.Saved(outcome.folder, outcome.suggestion?.confidence, pending = false, manual = false, described = true)
                                    }
                                    organiseQuietly(id)
                                }
                            }
                        },
                        onScreenshot = { uris ->
                            reelId?.let { id ->
                                lifecycleScope.launch {
                                    android.widget.Toast.makeText(this@ShareActivity, importer.import(id, uris), android.widget.Toast.LENGTH_SHORT).show()
                                    refresh(id)
                                    organiseQuietly(id)
                                }
                            }
                        },
                        onOpenApp = {
                            startActivity(Intent(this@ShareActivity, MainActivity::class.java))
                            finish()
                        },
                        onDone = { finish() },
                    )
                }
            }
        }

        lifecycleScope.launch {
            when (val result = repo.capture(shared)) {
                CaptureResult.Invalid -> ui.value = CaptureUi.Invalid
                is CaptureResult.Duplicate -> ui.value = CaptureUi.Duplicate(result.folder)
                is CaptureResult.Saved -> {
                    reelId = result.reel.id
                    ui.value = CaptureUi.Saved(repo.getFolders().firstOrNull { it.id == result.reel.folderId }, null, pending = true, manual = false)
                    val outcome = repo.enrich(result.reel.id)
                    if (outcome != null) {
                        ui.value = CaptureUi.Saved(
                            outcome.folder,
                            outcome.suggestion?.confidence,
                            pending = outcome.reel.enrichState == EnrichState.PENDING,
                            manual = outcome.reel.enrichState == EnrichState.MANUAL,
                        )
                    }
                    organiseQuietly(result.reel.id)
                }
            }
        }
    }

    /** Runs the AI step after new text arrives and refreshes the card. Silent when there is nothing to report. */
    private suspend fun organiseQuietly(id: Long) {
        val outcome = repo.organiseWithAi(id)
        outcome.userMessage()?.let { android.widget.Toast.makeText(this, it, android.widget.Toast.LENGTH_SHORT).show() }
        refresh(id)
    }

    private suspend fun refresh(id: Long) {
        val folderId = repo.observeReelOnce(id)?.folderId ?: return
        val current = ui.value as? CaptureUi.Saved ?: return
        ui.value = current.copy(folder = repo.getFolders().firstOrNull { it.id == folderId })
    }
}
