package com.reelbox.app.ui

import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.reelbox.app.data.Platform
import com.reelbox.app.domain.EmbedDecision
import com.reelbox.app.domain.EmbedHtml
import com.reelbox.app.domain.EmbedUrl
import com.reelbox.app.domain.OEmbedClient
import com.reelbox.app.domain.decideEmbed
import kotlinx.coroutines.launch

private sealed interface EmbedState {
    data object Idle : EmbedState
    data object Loading : EmbedState
    data class Official(val page: String) : EmbedState
    data class Basic(val note: String?) : EmbedState
    data object Unavailable : EmbedState
    data object Offline : EmbedState
}

/**
 * Shows the post as Instagram/Facebook display it (creator, caption, thumbnail) when its detail page opens.
 * Order: Meta's official oEmbed markup in a locked-down WebView, then the basic embed page as a
 * fallback. Private, removed, rate-limited and offline cases each get their own message.
 */
@Composable
fun EmbedView(platform: Platform, permalink: String, onAvailability: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    var state by remember(permalink) { mutableStateOf<EmbedState>(EmbedState.Idle) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val oEmbed = remember { OEmbedClient() }
    val openOriginal = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(permalink))) }; Unit }

    fun load() {
        state = EmbedState.Loading
        scope.launch {
            when (val decision = decideEmbed(platform, oEmbed.fetch(platform, permalink))) {
                is EmbedDecision.Show -> { state = EmbedState.Official(decision.page); onAvailability(true) }
                is EmbedDecision.Fallback -> { state = EmbedState.Basic(decision.note) }
                EmbedDecision.Unavailable -> { state = EmbedState.Unavailable }
                EmbedDecision.Offline -> state = EmbedState.Offline
            }
        }
    }

    LaunchedEffect(permalink) { load() }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        when (val s = state) {
            EmbedState.Idle -> {
                Link("👁 Show the ${platform.label} post here") { load() }
                Hint("Shows the creator, caption and thumbnail as ${platform.label} displays them. Needs internet.")
            }
            EmbedState.Loading -> Hint("Loading the ${platform.label} post…")
            is EmbedState.Official -> {
                key(s.page) { SecureEmbedWebView(platform, html = s.page, url = null) }
                Link("Not showing? Use the basic view") { state = EmbedState.Basic(null) }
                Link("Hide post") { state = EmbedState.Idle }
            }
            is EmbedState.Basic -> {
                s.note?.let { Hint(it) }
                key(permalink, "basic") { SecureEmbedWebView(platform, html = null, url = EmbedUrl.forReel(platform, permalink)) }
                Link("Hide post") { state = EmbedState.Idle }
            }
            EmbedState.Unavailable -> {
                Text("${platform.label} could not provide an official preview. The post may be private, removed or not embeddable. Your caption, notes and tags stay saved.", fontSize = 13.sp, lineHeight = 19.sp)
                Link("Try the basic view anyway") { state = EmbedState.Basic(null) }
                Link("Open in ${platform.label}") { openOriginal() }
            }
            EmbedState.Offline -> {
                Hint("Couldn't reach ${platform.label}. Check your connection.")
                Link("Try the basic view") { state = EmbedState.Basic(null) }
                Link("Try again") { load() }
            }
        }
    }
}

@Composable
private fun Link(text: String, onClick: () -> Unit) =
    Text(text, color = ReelboxColors.Pink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.clickable(onClick = onClick))

@Composable
private fun Hint(text: String) = Text(text, fontSize = 12.sp, color = ReelboxColors.Subtle, lineHeight = 17.sp)

@Composable
private fun SecureEmbedWebView(platform: Platform, html: String?, url: String?) {
    val context = LocalContext.current
    AndroidView(
        modifier = Modifier.fillMaxWidth().height(620.dp),
        factory = { ctx ->
            WebView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                configureSecureWebView(this) { link -> runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link))) } }
                if (html != null) loadDataWithBaseURL(EmbedHtml.baseUrl(platform), html, "text/html", "UTF-8", null)
                else if (url != null) loadUrl(url)
            }
        },
        onRelease = { it.destroy() },
    )
}
