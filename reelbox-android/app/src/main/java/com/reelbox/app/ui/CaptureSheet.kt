package com.reelbox.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reelbox.app.data.FolderEntity
import com.reelbox.app.domain.Confidence

sealed interface CaptureUi {
    data object Saving : CaptureUi
    data class Saved(
        val folder: FolderEntity?,
        val confidence: Confidence?,
        val pending: Boolean,
        val manual: Boolean,
        val described: Boolean = false,
    ) : CaptureUi
    data class Duplicate(val folder: FolderEntity?) : CaptureUi
    data object Invalid : CaptureUi
}

/** The card shown over Instagram/Facebook after Share → Reelbox. */
@Composable
fun CaptureSheet(
    state: CaptureUi,
    folders: List<FolderEntity>,
    onChangeFolder: (Long) -> Unit,
    onDescribe: (String) -> Unit,
    onScreenshot: (List<android.net.Uri>) -> Unit,
    onOpenApp: () -> Unit,
    onDone: () -> Unit,
) {
    Surface(shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp), shadowElevation = 12.dp, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when (state) {
                CaptureUi.Saving -> Text("Saving…", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                CaptureUi.Invalid -> {
                    Text("That doesn't look like a reel link", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Text("Reelbox saves Instagram and Facebook reels. Try sharing the reel's link.", color = ReelboxColors.Subtle, fontSize = 14.sp)
                    PinkButton("Close", onDone)
                }
                is CaptureUi.Duplicate -> {
                    Text("Already saved in ${state.folder?.name ?: "Inbox"}", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    PinkButton("Open Reelbox", onOpenApp)
                    Text("Done", color = ReelboxColors.Subtle, textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().clickable(onClick = onDone).padding(vertical = 6.dp))
                }
                is CaptureUi.Saved -> SavedBody(state, folders, onChangeFolder, onDescribe, onScreenshot, onOpenApp, onDone)
            }
        }
    }
}

@Composable
private fun SavedBody(
    state: CaptureUi.Saved,
    folders: List<FolderEntity>,
    onChangeFolder: (Long) -> Unit,
    onDescribe: (String) -> Unit,
    onScreenshot: (List<android.net.Uri>) -> Unit,
    onOpenApp: () -> Unit,
    onDone: () -> Unit,
) {
    val where = state.folder?.name ?: "Inbox"
    val detail = when {
        state.described && state.confidence == Confidence.HIGH -> "Organised from what you said"
        state.described -> "Not sure about this folder: change it below if needed"
        state.pending -> "Checking the public link. You can add details while you wait."
        state.manual -> "The link is saved. This provider may only supply a preview; add a caption or screenshot for more detail."
        state.confidence == Confidence.HIGH -> "Organised using the available details"
        else -> "Tell Reelbox what it is so it can add tags and file it"
    }
    Text("Saved to $where", fontSize = 18.sp, fontWeight = FontWeight.Bold)
    Text(detail, color = ReelboxColors.Subtle, fontSize = 13.sp)
    DescribeBox(onDescribe)
    ScreenshotPickerLink(onScreenshot)
    Text("Move to", fontWeight = FontWeight.Bold, fontSize = 13.sp)
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(folders, key = { it.id }) { f -> FolderChip("${f.emoji} ${f.name}", state.folder?.id == f.id) { onChangeFolder(f.id) } }
    }
    PinkButton("Done", onDone)
    Text("Open Reelbox", color = ReelboxColors.Pink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpenApp).padding(vertical = 4.dp))
}
