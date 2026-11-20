package com.reelbox.app.ui

import android.app.DatePickerDialog
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reelbox.app.data.ReelEntity
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * The event date found in the caption (or picked by the user) and the reminder for it: a notification at 09:00
 * the day before. Dates found automatically can be changed or removed here.
 */
@Composable
fun ReminderPanel(reel: ReelEntity, onEventDate: (LocalDate?) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val zone = ZoneId.systemDefault()
    val event = reel.eventDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
    fun pick() {
        val start = event ?: LocalDate.now().plusDays(1)
        DatePickerDialog(context, { _, y, m, d -> onEventDate(LocalDate.of(y, m + 1, d)) }, start.year, start.monthValue - 1, start.dayOfMonth).apply {
            datePicker.minDate = System.currentTimeMillis() - 1000
        }.show()
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (event == null) {
            Text("\u23F0 Remind me one day before\u2026", color = ReelboxColors.Pink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.clickable { pick() })
            Text("Reelbox also picks up dates it finds in a caption, such as 25 December, and sets this for you.", fontSize = 12.sp, color = ReelboxColors.Subtle, lineHeight = 17.sp)
        } else {
            Text("\uD83D\uDCC5 " + event.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL)), fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Text(
                reel.remindAt?.let { "\u23F0 Reminder: " + Instant.ofEpochMilli(it).atZone(zone).format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)) }
                    ?: "\u2705 Reminder sent",
                fontSize = 13.sp, color = ReelboxColors.Subtle,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("Change date", color = ReelboxColors.Pink, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.clickable { pick() })
                Text("Remove reminder", color = ReelboxColors.Subtle, fontSize = 13.sp, modifier = Modifier.clickable { onEventDate(null) })
            }
            Text("Notifications can arrive a few minutes late.", fontSize = 12.sp, color = ReelboxColors.Subtle)
        }
    }
}
