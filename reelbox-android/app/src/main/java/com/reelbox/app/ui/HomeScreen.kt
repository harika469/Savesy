package com.reelbox.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reelbox.app.data.FolderEntity
import com.reelbox.app.data.ReelWithFolder

data class HomeState(
    val reels: List<ReelWithFolder>,
    val allCount: Int,
    val thisWeek: Int,
    val folders: List<FolderEntity>,
    val selectedFolderId: Long?,
    val query: String,
)

private val hideWhenEmpty = setOf("Inbox", "Motivation")
private val folderOrder = listOf("Recipes", "Travel", "Fashion", "Home", "To Try", "Motivation", "Inbox")

/** Same chips as the mockup (Recipes, Travel, Fashion, Home, To Try); Inbox / Motivation only appear once used. */
fun visibleFolders(all: List<FolderEntity>, reels: List<ReelWithFolder>): List<FolderEntity> {
    val used = reels.map { it.reel.folderId }.toSet()
    return all.filter { it.name !in hideWhenEmpty || it.id in used }
        .sortedBy { folderOrder.indexOf(it.name).let { i -> if (i < 0) folderOrder.size else i } }
}

fun statsOf(all: List<ReelWithFolder>, nowMillis: Long): Pair<Int, Int> {
    val weekAgo = nowMillis - 7L * 24 * 3600 * 1000
    return all.size to all.count { it.reel.createdAt >= weekAgo }
}

@Composable
fun HomeScreen(
    state: HomeState,
    onQuery: (String) -> Unit,
    onSelectFolder: (Long?) -> Unit,
    onOpen: (Long) -> Unit,
    clipboardLink: String? = null,
    onSaveClipboard: () -> Unit = {},
    onDismissClipboard: () -> Unit = {},
    onAddByLink: () -> Unit = {},
    onOpenInstagram: () -> Unit = {},
    onSampleClick: () -> Unit = {},
    contentPadding: PaddingValues = PaddingValues(0.dp),
) {
    val full = GridItemSpan(2)
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        modifier = Modifier.fillMaxSize().testTag("home-grid"),
        contentPadding = PaddingValues(
            start = 16.dp, end = 16.dp,
            top = contentPadding.calculateTopPadding() + 16.dp,
            bottom = contentPadding.calculateBottomPadding() + 80.dp,
        ),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(span = { full }) {
            Column {
                Text("📦 Reelbox", fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Text("Your saved reels, finally organised", fontSize = 14.sp, color = ReelboxColors.Muted)
            }
        }
        if (clipboardLink != null) {
            item(span = { full }) { ClipboardBanner(clipboardLink, onSaveClipboard, onDismissClipboard) }
        }
        item(span = { full }) {
            PillField(state.query, onQuery, "Search saved reels... e.g. paneer, Amsterdam, hair", Modifier.testTag("search"))
        }
        item(span = { full }) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatTile(state.allCount, "Saved", Modifier.weight(1f))
                StatTile(state.folders.size, "Folders", Modifier.weight(1f))
                StatTile(state.thisWeek, "This week", Modifier.weight(1f))
            }
        }
        item(span = { full }) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { FolderChip("All", state.selectedFolderId == null) { onSelectFolder(null) } }
                items(state.folders, key = { it.id }) { folder ->
                    FolderChip(folder.name, state.selectedFolderId == folder.id) { onSelectFolder(folder.id) }
                }
            }
        }
        val showSamples = state.allCount == 0 && state.query.isBlank() && state.selectedFolderId == null
        if (showSamples) {
            item(span = { full }) {
                Text(
                    "Sample reels. Yours will appear here once you share one.",
                    color = ReelboxColors.Subtle, fontSize = 12.sp, textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            items(SampleReels.items, key = { it.reel.id }) { item -> ReelCard(item, onClick = onSampleClick, topBadge = "Sample") }
        } else if (state.reels.isEmpty()) {
            item(span = { full }) {
                Text(
                    "No reels match that.",
                    color = ReelboxColors.Subtle, textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
                )
            }
        } else {
            items(state.reels, key = { it.reel.id }) { item -> ReelCard(item, onClick = { onOpen(item.reel.id) }) }
        }
        item(span = { full }) { HowItWorksNote(Modifier.padding(top = 2.dp)) }
        item(span = { full }) { PinkButton("Open Instagram to try Share → Reelbox", onOpenInstagram) }
        item(span = { full }) {
            Text(
                "+ Add a reel link",
                color = ReelboxColors.Pink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().clickable(onClick = onAddByLink).padding(vertical = 4.dp),
            )
        }
        item(span = { full }) {
            Text("Reelbox • Works offline", fontSize = 12.sp, color = Color(0xFF888888), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}

/** "You copied a reel link. Save it?" A fallback for when the share sheet isn't convenient. */
@Composable
fun ClipboardBanner(link: String, onSave: () -> Unit, onDismiss: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(ReelboxColors.NoteBg, RoundedCornerShape(12.dp))
            .border(1.dp, ReelboxColors.NoteBorder, RoundedCornerShape(12.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Reel link copied", fontWeight = FontWeight.Bold, fontSize = 13.sp)
        Text(link.removePrefix("https://").removePrefix("www.").take(48), fontSize = 13.sp, color = ReelboxColors.Muted, maxLines = 1)
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Save to Reelbox", color = ReelboxColors.Pink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.clickable(onClick = onSave))
            Text("Not now", color = ReelboxColors.Subtle, fontSize = 14.sp, modifier = Modifier.clickable(onClick = onDismiss))
        }
    }
}
