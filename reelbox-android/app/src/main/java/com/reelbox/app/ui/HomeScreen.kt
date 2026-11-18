package com.reelbox.app.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reelbox.app.data.FolderEntity
import com.reelbox.app.data.ReelStatus
import com.reelbox.app.data.ReelWithFolder

data class HomeState(
    val reels: List<ReelWithFolder>,
    val allCount: Int,
    val thisWeek: Int,
    val untried: Int,
    val folders: List<FolderEntity>,
    val selectedFolderId: Long?,
    val query: String,
)

fun statsOf(all: List<ReelWithFolder>, nowMillis: Long): Triple<Int, Int, Int> {
    val weekAgo = nowMillis - 7L * 24 * 3600 * 1000
    return Triple(
        all.size,
        all.count { it.reel.createdAt >= weekAgo },
        all.count { it.reel.status == ReelStatus.NEW || it.reel.status == ReelStatus.TO_TRY },
    )
}

@Composable
fun HomeScreen(
    state: HomeState,
    onQuery: (String) -> Unit,
    onSelectFolder: (Long?) -> Unit,
    onOpen: (Long) -> Unit,
    contentPadding: PaddingValues = PaddingValues(0.dp),
) {
    val full = GridItemSpan(2)
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        modifier = Modifier.fillMaxSize().testTag("home-grid"),
        contentPadding = PaddingValues(
            start = 16.dp, end = 16.dp,
            top = contentPadding.calculateTopPadding() + 16.dp,
            bottom = contentPadding.calculateBottomPadding() + 96.dp,
        ),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(span = { full }) {
            androidx.compose.foundation.layout.Column {
                Text("📦 Reelbox", fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Text("Your saved reels, finally organised", fontSize = 14.sp, color = ReelboxColors.Muted)
            }
        }
        item(span = { full }) {
            TextField(
                value = state.query,
                onValueChange = onQuery,
                singleLine = true,
                placeholder = { Text("Search saved reels... e.g. paneer, Amsterdam, hair", fontSize = 15.sp, color = Color(0xFF8A8A8A), maxLines = 1) },
                shape = CircleShape,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = ReelboxColors.SearchBg, unfocusedContainerColor = ReelboxColors.SearchBg,
                    focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                ),
                modifier = Modifier.fillMaxWidth().border(1.dp, ReelboxColors.SearchBorder, CircleShape).testTag("search"),
            )
        }
        item(span = { full }) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatTile(state.allCount, "Saved", Modifier.weight(1f))
                StatTile(state.thisWeek, "This week", Modifier.weight(1f))
                StatTile(state.untried, "Untried", Modifier.weight(1f))
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
        if (state.reels.isEmpty()) {
            item(span = { full }) {
                Text(
                    if (state.allCount == 0) "Nothing saved yet. Share any reel to Reelbox to start." else "No reels match that.",
                    color = ReelboxColors.Subtle, textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
                )
            }
        } else {
            items(state.reels, key = { it.reel.id }) { item -> ReelCard(item, onClick = { onOpen(item.reel.id) }) }
        }
        item(span = { full }) { HowItWorksNote(Modifier.padding(top = 2.dp)) }
        item(span = { full }) {
            Text("Reelbox • Works offline", fontSize = 12.sp, color = Color(0xFF888888), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}
