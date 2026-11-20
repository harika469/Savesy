package com.reelbox.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reelbox.app.data.ReelEntity
import com.reelbox.app.data.ai
import com.reelbox.app.domain.ReelAi

/** AI results for a reel (summary, ingredients, places, products, ideas) and the button that creates them. */
@Composable
fun AiPanel(reel: ReelEntity, onOrganise: () -> Unit, modifier: Modifier = Modifier) {
    val ai = reel.ai
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            if (ai == null) "✨ Organise with AI" else "✨ Organise again",
            color = ReelboxColors.Pink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
            modifier = Modifier.clickable(onClick = onOrganise),
        )
        if (ai == null) {
            Text("Uses the caption or your words to add a summary, ingredients, places and ideas. Only that text is sent, never the video or your account.", fontSize = 12.sp, color = ReelboxColors.Subtle)
        } else {
            if (ai.summary.isNotBlank()) Text(ai.summary, fontSize = 14.sp, lineHeight = 20.sp)
            ai.cookingTimeMinutes?.let { Text("⏱ $it min", fontSize = 13.sp) }
            if (ai.ingredients.isNotEmpty()) Text("🛒 Ingredients: ${ai.ingredients.joinToString(", ")}", fontSize = 13.sp, lineHeight = 19.sp)
            if (ai.locations.isNotEmpty()) Text("📍 Places: ${ai.locations.joinToString(", ")}", fontSize = 13.sp, lineHeight = 19.sp)
            if (ai.products.isNotEmpty()) Text("🛍 Products: ${ai.products.joinToString(", ")}", fontSize = 13.sp, lineHeight = 19.sp)
            val ideas = ai.suggestedActions.mapNotNull { ReelAi.actionLabels[it] }
            if (ideas.isNotEmpty()) Text("💡 ${ideas.joinToString(" · ")}", fontSize = 13.sp, color = ReelboxColors.Subtle)
        }
    }
}
