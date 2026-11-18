package com.reelbox.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reelbox.app.data.FolderEntity
import com.reelbox.app.data.NOTE_LIMIT
import com.reelbox.app.data.ReelStatus
import com.reelbox.app.data.ReelWithFolder

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DetailScreen(
    item: ReelWithFolder,
    folders: List<FolderEntity>,
    onOpenOriginal: () -> Unit,
    onStatus: (ReelStatus) -> Unit,
    onMove: (Long) -> Unit,
    onNote: (String) -> Unit,
    onTitle: (String) -> Unit,
    onDelete: () -> Unit,
) {
    val reel = item.reel
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var note by remember(reel.id) { mutableStateOf(reel.note) }
    var title by remember(reel.id) { mutableStateOf(reel.title) }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        ReelThumb(item, 260.dp)
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (reel.isUnavailable) {
                Text("This reel is no longer available. Your note and tags are kept.", color = Color(0xFFB91C1C), fontSize = 13.sp)
            }
            if (reel.enrichState == com.reelbox.app.data.EnrichState.MANUAL) {
                Text("Private or unavailable reel: add a title and note yourself.", color = ReelboxColors.Subtle, fontSize = 13.sp)
            }
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("Title") },
                modifier = Modifier.fillMaxWidth(),
                trailingIcon = { if (title != reel.title) TextButton(onClick = { onTitle(title) }) { Text("Save") } },
            )
            Text("${reel.creatorHandle ?: reel.platform.label} • ${item.folder?.name ?: "Inbox"}", color = ReelboxColors.Subtle, fontSize = 13.sp)
            if (reel.caption.isNotBlank()) Text(reel.caption, fontSize = 14.sp, lineHeight = 20.sp)
            if (reel.tagList.isNotEmpty()) TagPills(reel.tagList)

            Text("Status", fontWeight = FontWeight.Bold)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(ReelStatus.TO_TRY, ReelStatus.TRIED, ReelStatus.DONE, ReelStatus.ARCHIVED).forEach { status ->
                    FolderChip(status.label, reel.status == status) { onStatus(if (reel.status == status) ReelStatus.NEW else status) }
                }
            }

            Text("Folder", fontWeight = FontWeight.Bold)
            Column {
                OutlinedButton(onClick = { menu = true }) { Text("${item.folder?.emoji ?: ""} ${item.folder?.name ?: "Inbox"} ▾") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    folders.forEach { folder ->
                        DropdownMenuItem(text = { Text("${folder.emoji} ${folder.name}") }, onClick = { menu = false; onMove(folder.id) })
                    }
                }
            }

            OutlinedTextField(
                value = note,
                onValueChange = { if (it.length <= NOTE_LIMIT) { note = it; onNote(it) } },
                label = { Text("Note") },
                supportingText = { Text("${note.length}/$NOTE_LIMIT") },
                placeholder = { Text("e.g. Try Sunday") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
            )

            Button(
                onClick = onOpenOriginal,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = ReelboxColors.Pink),
            ) { Text("Open in ${reel.platform.label}") }
            TextButton(onClick = { confirmDelete = true }, modifier = Modifier.fillMaxWidth()) { Text("Delete", color = Color(0xFFB91C1C)) }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete this reel?") },
            text = { Text("This removes it from Reelbox only. The original stays on ${reel.platform.label}.") },
            confirmButton = { TextButton(onClick = { confirmDelete = false; onDelete() }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}
