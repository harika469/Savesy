package com.reelbox.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

object ReelboxColors {
    val Ink = Color(0xFF111111)
    val Muted = Color(0xFF666666)
    val Subtle = Color(0xFF777777)
    val Pink = Color(0xFFEC4899)
    val SearchBg = Color(0xFFF6F6F6)
    val SearchBorder = Color(0xFFE5E5E5)
    val StatBg = Color(0xFFFFF7ED)
    val StatBorder = Color(0xFFFFE4C7)
    val Pill = Color(0xFFFEF3C7)
    val NoteBg = Color(0xFFFFFBEB)
    val NoteBorder = Color(0xFFFDE68A)
    val CardBorder = Color(0xFFEEEEEE)

    private val gradients = listOf(
        Color(0xFFF97316) to Color(0xFFEF4444),
        Color(0xFF06B6D4) to Color(0xFF3B82F6),
        Color(0xFFEC4899) to Color(0xFFA855F7),
        Color(0xFF22C55E) to Color(0xFF16A34A),
        Color(0xFFF59E0B) to Color(0xFFF97316),
        Color(0xFF8B5CF6) to Color(0xFFEC4899),
    )

    fun gradientFor(seed: Long): Brush {
        val (a, b) = gradients[(seed % gradients.size).toInt().let { if (it < 0) it + gradients.size else it }]
        return Brush.linearGradient(listOf(a, b))
    }
}

@Composable
fun ReelboxTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = ReelboxColors.Pink,
            onPrimary = Color.White,
            surface = Color.White,
            background = Color.White,
            onSurface = ReelboxColors.Ink,
        ),
        content = content,
    )
}
