package com.reelbox.app.ui

import android.annotation.SuppressLint
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.reelbox.app.domain.EmbedPolicy
import java.io.ByteArrayInputStream

/**
 * A WebView locked down for showing a platform embed: no file or content access, no mixed content, no popups,
 * no third-party cookies, no JavaScript bridge, and only HTTPS requests to Instagram / Facebook hosts.
 * JavaScript stays on because the embed cannot render without it.
 */
@SuppressLint("SetJavaScriptEnabled")
fun configureSecureWebView(webView: WebView, openExternally: (String) -> Unit) {
    webView.settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        allowFileAccess = false
        allowContentAccess = false
        @Suppress("DEPRECATION") allowFileAccessFromFileURLs = false
        @Suppress("DEPRECATION") allowUniversalAccessFromFileURLs = false
        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        javaScriptCanOpenWindowsAutomatically = false
        setSupportMultipleWindows(false)
        setGeolocationEnabled(false)
        safeBrowsingEnabled = true
    }
    CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
    webView.webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            // Only an embed page may load in place; any other link opens in the browser (HTTPS only).
            if (EmbedPolicy.isAllowed(url) && (url.contains("/embed") || url.contains("/plugins/"))) return false
            if (EmbedPolicy.mayOpenExternally(url)) openExternally(url)
            return true
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            if (EmbedPolicy.isAllowedResource(request.url.toString())) null
            else WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }
}
