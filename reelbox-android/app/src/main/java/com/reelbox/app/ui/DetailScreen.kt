package com.reelbox.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.clickable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reelbox.app.data.EnrichState
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
    onDescribe: (String) -> Unit,
    onDelete: () -> Unit,
) {
    val reel = item.reel
    var confirmDelete by remember { mutableStateOf(false) }
    var note by remember(reel.id) { mutableStateOf(reel.note) }
    var title by remember(reel.id) { mutableStateOf(reel.title) }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        ReelThumb(item, 220.dp)
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            PillField(
                value = title,
                onValueChange = { title = it },
                placeholder = "Title",
                trailing = { if (title != reel.title) Text("Save", color = ReelboxColors.Pink, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable { onTitle(title) }) },
            )
            Text("${reel.creatorHandle ?: reel.platform.label} • ${item.folder?.name ?: "Inbox"}", color = ReelboxColors.Subtle, fontSize = 12.sp)
            if (reel.isUnavailable) Text("This reel is no longer available. Your note and tags are kept.", color = Color(0xFFB91C1C), fontSize = 13.sp)
            if (reel.caption.isNotBlank()) Text(reel.caption, fontSize = 14.sp, lineHeight = 20.sp)
            if (reel.tagList.isNotEmpty()) TagPills(reel.tagList)

            if (reel.enrichState == EnrichState.MANUAL && reel.note.isBlank()) {
                Column(
                    Modifier.fillMaxWidth().padding(top = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("What is this reel about?", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text("Say a few words, or type them. Reelbox adds a title and tags and files it for you.", fontSize = 13.sp, color = ReelboxColors.Subtle)
                    DescribeBox(onDescribe)
                }
            }

            Text("Status", fontWeight = FontWeight.Bold, fontSize = 15.sp)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(ReelStatus.TO_TRY, ReelStatus.TRIED, ReelStatus.DONE, ReelStatus.ARCHIVED).forEach { status ->
                    FolderChip(status.label, reel.status == status) { onStatus(if (reel.status == status) ReelStatus.NEW else status) }
                }
            }

            Text("Folder", fontWeight = FontWeight.Bold, fontSize = 15.sp)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(folders, key = { it.id }) { folder ->
                    FolderChip("${folder.emoji} ${folder.name}", item.folder?.id == folder.id) { onMove(folder.id) }
                }
            }

            Text("Note", fontWeight = FontWeight.Bold, fontSize = 15.sp)
            PillField(
                value = note,
                onValueChange = { if (it.length <= NOTE_LIMIT) { note = it; onNote(it) } },
                placeholder = "e.g. Try Sunday",
                singleLine = false,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.padding(bottom = 0.dp),
            )
            Text("${note.length}/$NOTE_LIMIT", fontSize = 12.sp, color = ReelboxColors.Subtle, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth())

            PinkButton("Open in ${reel.platform.label}", onOpenOriginal)
            Text("Delete", color = Color(0xFFB91C1C), fontSize = 14.sp, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().clickable { confirmDelete = true }.padding(vertical = 8.dp))
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
