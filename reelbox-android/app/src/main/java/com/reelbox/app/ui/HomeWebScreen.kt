package com.reelbox.app.ui

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader

class HomeActions(
    val onQuery: (String) -> Unit,
    val onSelectFolder: (Long?) -> Unit,
    val onOpen: (Long) -> Unit,
    val onSaveClipboard: () -> Unit,
    val onDismissClipboard: () -> Unit,
    val onAddByLink: () -> Unit,
    val onOpenInstagram: () -> Unit,
    val onSampleClick: () -> Unit,
)

/** Everything the page can ask the app to do. Calls arrive on a WebView thread, so they hop to the main thread. */
private class HomeBridge(private val actions: () -> HomeActions, private val onReady: () -> Unit) {
    private val ui = Handler(Looper.getMainLooper())
    private fun run(block: HomeActions.() -> Unit) { ui.post { actions().block() } }

    @JavascriptInterface fun ready() { ui.post(onReady) }
    @JavascriptInterface fun search(query: String) = run { onQuery(query.take(200)) }
    @JavascriptInterface fun folder(id: String) = run { onSelectFolder(id.toLongOrNull()) }
    @JavascriptInterface fun openReel(id: String) { id.toLongOrNull()?.takeIf { it > 0 }?.let { run { onOpen(it) } } }
    @JavascriptInterface fun sample(id: String) = run { onSampleClick() }
    @JavascriptInterface fun openInstagram() = run { onOpenInstagram() }
    @JavascriptInterface fun addLink() = run { onAddByLink() }
    @JavascriptInterface fun saveClipboard() = run { onSaveClipboard() }
    @JavascriptInterface fun dismissClipboard() = run { onDismissClipboard() }
}

/**
 * The home screen is the Reelbox HTML/CSS design, bundled in assets/ and filled with the app's real data.
 * HTML, CSS and look are the shared design file; only the data comes from the app.
 */
@Composable
fun HomeWebScreen(state: HomeState, clipboardLink: String?, actions: HomeActions, contentPadding: PaddingValues) {
    val context = LocalContext.current
    val json = remember(state, clipboardLink) { HomeJson.build(state, clipboardLink) }
    val latestJson = rememberUpdatedState(json)
    val latestActions = rememberUpdatedState(actions)
    val holder = remember { arrayOfNulls<WebView>(1) }
    val bridge = remember { HomeBridge({ latestActions.value }) { holder[0]?.evaluateJavascript("render(${latestJson.value})", null) } }

    Box(Modifier.fillMaxSize().background(Color.White).padding(top = contentPadding.calculateTopPadding(), bottom = contentPadding.calculateBottomPadding())) {
        AndroidView(
            modifier = Modifier.fillMaxSize().padding(0.dp),
            factory = { ctx ->
                WebView(ctx).apply {
                    setBackgroundColor(android.graphics.Color.WHITE)
                    val loader = WebViewAssetLoader.Builder().setDomain(LOCAL_PAGE_HOST).addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx)).build()
                    configureLocalPageWebView(this, loader)
                    addJavascriptInterface(bridge, "Reelbox")
                    holder[0] = this
                    loadUrl("https://$LOCAL_PAGE_HOST/assets/reelbox_home.html")
                }
            },
            update = { view ->
                // Re-render whenever the data changes (the page keeps its own search box, so typing never loses focus).
                if (view.getTag(LAST_JSON_TAG) != json) {
                    view.setTag(LAST_JSON_TAG, json)
                    view.evaluateJavascript("if (window.render) render($json)", null)
                }
            },
            onRelease = { holder[0] = null; it.removeJavascriptInterface("Reelbox"); it.destroy() },
        )
    }
}

/** True when the phone has a working system WebView; otherwise the app falls back to its native home screen. */
fun webViewAvailable(): Boolean = runCatching { WebView.getCurrentWebViewPackage() != null }.getOrDefault(false)

private const val LAST_JSON_TAG = 0x7f0a0001
