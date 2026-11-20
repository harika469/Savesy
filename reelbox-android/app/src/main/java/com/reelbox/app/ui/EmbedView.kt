package com.reelbox.app.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.clickable
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.reelbox.app.data.Platform
import com.reelbox.app.domain.EmbedUrl

/**
 * Shows the platform's own embed of the reel (creator, caption, thumbnail). Loaded only when the user taps,
 * so nothing is requested from Instagram/Facebook until they ask for it.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun EmbedView(platform: Platform, permalink: String, modifier: Modifier = Modifier) {
    var shown by remember(permalink) { mutableStateOf(false) }
    val context = LocalContext.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            if (shown) "Hide ${platform.label} post" else "👁 Show the ${platform.label} post here",
            color = ReelboxColors.Pink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
            modifier = Modifier.clickable { shown = !shown },
        )
        if (!shown) {
            Text("Shows the creator, caption and thumbnail as ${platform.label} displays them. Needs internet.", fontSize = 12.sp, color = ReelboxColors.Subtle)
        } else {
            AndroidView(
                modifier = Modifier.fillMaxWidth().height(560.dp),
                factory = { ctx ->
                    WebView(ctx).apply {
                        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                        settings.javaScriptEnabled = true // the embed page needs it to render
                        settings.domStorageEnabled = true
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                                val url = request.url.toString()
                                if (EmbedUrl.isEmbedHost(url) && url.contains("embed")) return false
                                if (EmbedUrl.isEmbedHost(url) && url.contains("plugins/")) return false
                                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                                return true
                            }
                        }
                        loadUrl(EmbedUrl.forReel(platform, permalink))
                    }
                },
                onRelease = { it.destroy() },
            )
        }
    }
}
