package com.reelbox.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import coil.compose.AsyncImage
import com.reelbox.app.data.ReelStatus
import com.reelbox.app.data.ReelWithFolder

/** Thumbnail from oEmbed, or a gradient with the folder emoji when there is none (or it can't load). */
@Composable
fun ReelThumb(item: ReelWithFolder, height: Dp, modifier: Modifier = Modifier) {
    val reel = item.reel
    Box(modifier.fillMaxWidth().height(height).background(ReelboxColors.gradientFor(reel.id)), contentAlignment = Alignment.Center) {
        Text(item.folder?.emoji ?: "🎬", fontSize = 32.sp)
        if (reel.thumbnailUrl != null) {
            AsyncImage(model = reel.thumbnailUrl, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
        Text(
            reel.platform.label,
            color = Color.White,
            fontSize = 11.sp,
            modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp)
                .background(Color.Black.copy(alpha = 0.6f), CircleShape).padding(horizontal = 7.dp, vertical = 3.dp),
        )
        if (reel.status != ReelStatus.NEW) {
            Text(
                reel.status.label,
                color = Color.White,
                fontSize = 11.sp,
                modifier = Modifier.align(Alignment.TopStart).padding(8.dp)
                    .background(ReelboxColors.Pink, CircleShape).padding(horizontal = 7.dp, vertical = 3.dp),
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TagPills(tags: List<String>, modifier: Modifier = Modifier) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        tags.forEach {
            Text("#$it", fontSize = 11.sp, color = ReelboxColors.Ink,
                modifier = Modifier.background(ReelboxColors.Pill, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp))
        }
    }
}

@Composable
fun ReelCard(item: ReelWithFolder, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val reel = item.reel
    Card(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, ReelboxColors.CardBorder),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column {
            ReelThumb(item, 170.dp)
            Column(Modifier.padding(10.dp)) {
                Text(reel.title, fontSize = 14.sp, fontWeight = FontWeight.Bold, lineHeight = 18.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val who = reel.creatorHandle ?: reel.platform.label
                Text("$who • ${item.folder?.name ?: "Inbox"}", fontSize = 12.sp, color = ReelboxColors.Subtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (reel.tagList.isNotEmpty()) TagPills(reel.tagList.take(3), Modifier.padding(top = 6.dp))
            }
        }
    }
}

@Composable
fun FolderChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val shape = CircleShape
    Text(
        label,
        fontSize = 14.sp,
        color = if (selected) Color.White else ReelboxColors.Ink,
        modifier = Modifier.clip(shape)
            .background(if (selected) ReelboxColors.Ink else Color.White)
            .border(1.dp, if (selected) ReelboxColors.Ink else ReelboxColors.CardBorder, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

@Composable
fun StatTile(value: Int, label: String, modifier: Modifier = Modifier) {
    Column(
        modifier.background(ReelboxColors.StatBg, RoundedCornerShape(14.dp))
            .border(1.dp, ReelboxColors.StatBorder, RoundedCornerShape(14.dp)).padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value.toString(), fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text(label, fontSize = 14.sp)
    }
}

@Composable
fun HowItWorksNote(modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().background(ReelboxColors.NoteBg, RoundedCornerShape(12.dp))
            .border(1.dp, ReelboxColors.NoteBorder, RoundedCornerShape(12.dp)).padding(12.dp),
    ) {
        Text("How it works:", fontWeight = FontWeight.Bold, fontSize = 13.sp)
        listOf(
            "1. In Instagram or Facebook tap Share → Reelbox",
            "2. Say a few words about it. Reelbox turns them into tags",
            "3. It auto-files into Recipes / Travel / Fashion etc.",
            "4. Search later instead of scrolling saved!",
        ).forEach { Text(it, fontSize = 13.sp, lineHeight = 20.sp) }
    }
}

@Composable
fun SectionGap(height: Dp = 12.dp) = Box(Modifier.height(height))

/** Rounded grey input exactly like the mockup's search box (pill) or a taller rounded box for notes. */
@Composable
fun PillField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    shape: Shape = CircleShape,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth().clip(shape).background(ReelboxColors.SearchBg)
            .border(1.dp, ReelboxColors.SearchBorder, shape).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(placeholder, color = Color(0xFF8A8A8A), fontSize = 15.sp, maxLines = if (singleLine) 1 else 3)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = singleLine,
                textStyle = TextStyle(fontSize = 15.sp, color = ReelboxColors.Ink),
                cursorBrush = SolidColor(ReelboxColors.Ink),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        trailing?.invoke()
    }
}

/** The mockup's pink full-width button. */
@Composable
fun PinkButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(ReelboxColors.Pink)
            .clickable(onClick = onClick).padding(10.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
}

@Composable
fun MicButton(onClick: () -> Unit) {
    Box(
        Modifier.size(36.dp).clip(CircleShape).background(ReelboxColors.Pink).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text("🎤", fontSize = 16.sp) }
}

/**
 * "Say something and we organise it". Speak (mic) or type, then Reelbox turns the words into a title,
 * tags and a folder.
 */
@Composable
fun DescribeBox(onSubmit: (String) -> Unit, modifier: Modifier = Modifier, placeholder: String = "Say or type what it is, e.g. paneer recipe to try Sunday") {
    var text by remember { mutableStateOf("") }
    val speak = rememberVoiceInput { spoken -> onSubmit(spoken) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        PillField(
            value = text,
            onValueChange = { text = it },
            placeholder = placeholder,
            trailing = { Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (text.isNotBlank()) Text("Organise", color = ReelboxColors.Pink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                    modifier = Modifier.clickable { onSubmit(text); text = "" })
                MicButton(speak)
            } },
        )
    }
}
