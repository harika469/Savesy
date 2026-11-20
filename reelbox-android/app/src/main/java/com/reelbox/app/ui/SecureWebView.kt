package com.reelbox.app.ui

import android.annotation.SuppressLint
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
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
            // Never launch an external app because a background iframe navigated.
            if (request.isForMainFrame && request.hasGesture() && EmbedPolicy.mayOpenExternally(url)) openExternally(url)
            return true
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            if (EmbedPolicy.isAllowedResource(request.url.toString())) null
            else WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }
}

const val LOCAL_PAGE_HOST = "appassets.androidplatform.net"

/**
 * For the app's own bundled pages (assets/): served over a private https origin by WebViewAssetLoader, so the page
 * needs no file access. Everything that is not that origin is blocked, and navigation away is refused.
 */
@SuppressLint("SetJavaScriptEnabled")
fun configureLocalPageWebView(webView: WebView, assetLoader: WebViewAssetLoader) {
    webView.settings.apply {
        javaScriptEnabled = true
        allowFileAccess = false
        allowContentAccess = false
        @Suppress("DEPRECATION") allowFileAccessFromFileURLs = false
        @Suppress("DEPRECATION") allowUniversalAccessFromFileURLs = false
        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        javaScriptCanOpenWindowsAutomatically = false
        setSupportMultipleWindows(false)
        setGeolocationEnabled(false)
        safeBrowsingEnabled = false // nothing external is ever loaded
    }
    webView.webViewClient = object : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            if (request.url.host == LOCAL_PAGE_HOST) assetLoader.shouldInterceptRequest(request.url)
            else WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
    }
}
