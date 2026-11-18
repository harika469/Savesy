package com.reelbox.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reelbox.app.data.FolderEntity
import com.reelbox.app.data.NOTE_LIMIT
import com.reelbox.app.domain.Confidence

sealed interface CaptureUi {
    data object Saving : CaptureUi
    data class Saved(val folder: FolderEntity?, val confidence: Confidence?, val pending: Boolean, val manual: Boolean) : CaptureUi
    data class Duplicate(val folder: FolderEntity?) : CaptureUi
    data object Invalid : CaptureUi
}

/** The "Saved to Recipes" card shown over Instagram/Facebook after Share → Reelbox. */
@Composable
fun CaptureSheet(
    state: CaptureUi,
    folders: List<FolderEntity>,
    onChangeFolder: (Long) -> Unit,
    onNote: (String) -> Unit,
    onOpenApp: () -> Unit,
    onDone: () -> Unit,
) {
    Surface(shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp), shadowElevation = 12.dp, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when (state) {
                CaptureUi.Saving -> Text("Saving…", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                CaptureUi.Invalid -> {
                    Text("That doesn't look like a reel link", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Text("Reelbox saves Instagram and Facebook reels. Try sharing the reel's link.", color = ReelboxColors.Subtle)
                    Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Close") }
                }
                is CaptureUi.Duplicate -> {
                    Text("Already saved in ${state.folder?.name ?: "Inbox"}", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = onDone) { Text("Done") }
                        Button(onClick = onOpenApp, colors = ButtonDefaults.buttonColors(containerColor = ReelboxColors.Pink)) { Text("Open Reelbox") }
                    }
                }
                is CaptureUi.Saved -> SavedBody(state, folders, onChangeFolder, onNote, onOpenApp, onDone)
            }
        }
    }
}

@Composable
private fun SavedBody(
    state: CaptureUi.Saved,
    folders: List<FolderEntity>,
    onChangeFolder: (Long) -> Unit,
    onNote: (String) -> Unit,
    onOpenApp: () -> Unit,
    onDone: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    var addNote by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    val where = state.folder?.name ?: "Inbox"
    val detail = when {
        state.pending -> "No connection: details will be added when you're online"
        state.manual -> "Couldn't read this reel (private?). Add a note yourself"
        state.confidence == Confidence.HIGH -> "Filed automatically"
        state.confidence == Confidence.LOW -> "Not sure about this folder: change it if needed"
        else -> "Fetching details…"
    }
    Text("Saved to $where", fontSize = 18.sp, fontWeight = FontWeight.Bold)
    Text(detail, color = ReelboxColors.Subtle, fontSize = 13.sp)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column {
            OutlinedButton(onClick = { menu = true }) { Text("Change folder") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                folders.forEach { f -> DropdownMenuItem(text = { Text("${f.emoji} ${f.name}") }, onClick = { menu = false; onChangeFolder(f.id) }) }
            }
        }
        OutlinedButton(onClick = { addNote = !addNote }) { Text("Add note") }
    }
    if (addNote) {
        OutlinedTextField(
            value = note,
            onValueChange = { if (it.length <= NOTE_LIMIT) { note = it; onNote(it) } },
            placeholder = { Text("Why did you save it?") },
            modifier = Modifier.fillMaxWidth(),
        )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = onDone, colors = ButtonDefaults.buttonColors(containerColor = ReelboxColors.Pink)) { Text("Done") }
        TextButton(onClick = onOpenApp) { Text("Open Reelbox") }
    }
}
