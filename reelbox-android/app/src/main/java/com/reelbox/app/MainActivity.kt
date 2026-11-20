package com.reelbox.app

import android.content.ActivityNotFoundException
import android.content.ClipboardManager
import androidx.activity.viewModels
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.reelbox.app.ui.DetailScreen
import com.reelbox.app.ui.DetailViewModel
import com.reelbox.app.ui.HomeActions
import com.reelbox.app.ui.HomeScreen
import com.reelbox.app.ui.HomeWebScreen
import com.reelbox.app.ui.webViewAvailable
import com.reelbox.app.ui.HomeViewModel
import com.reelbox.app.ui.PillField
import com.reelbox.app.ui.ReelboxTheme

class MainActivity : ComponentActivity() {
    private val homeViewModel: HomeViewModel by viewModels()
    /** Set when the user taps a reminder notification; the navigation consumes it. */
    private val openReel = kotlinx.coroutines.flow.MutableStateFlow<Long?>(null)

    private fun handleIntent(intent: Intent?) {
        intent?.getLongExtra(Notifications.EXTRA_REEL_ID, -1L)?.takeIf { it > 0 }?.let { openReel.value = it }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleIntent(intent)
        setContent { ReelboxTheme { ReelboxNav(homeViewModel, openReel) } }
    }

    // Android only lets the app in the foreground read the clipboard, so check once we have focus.
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus) return
        val clipboard = getSystemService(ClipboardManager::class.java)
        val text = clipboard?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()
        homeViewModel.checkClipboard(text)
    }
}

@Composable
private fun ReelboxNav(homeViewModel: HomeViewModel, openReel: kotlinx.coroutines.flow.MutableStateFlow<Long?>) {
    val nav = rememberNavController()
    val requested by openReel.collectAsStateWithLifecycle()
    LaunchedEffect(requested) { requested?.let { nav.navigate("reel/$it"); openReel.value = null } }
    NavHost(nav, startDestination = "home") {
        composable("home") { HomeRoute(onOpen = { nav.navigate("reel/$it") }, vm = homeViewModel) }
        composable("reel/{id}", arguments = listOf(navArgument("id") { type = NavType.LongType })) { entry ->
            val id = entry.arguments!!.getLong("id")
            DetailRoute(id, onBack = { nav.popBackStack() })
        }
    }
}

@Composable
private fun HomeRoute(onOpen: (Long) -> Unit, vm: HomeViewModel) {
    val context = LocalContext.current
    val state by vm.state.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val clipboardLink by vm.clipboardLink.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var adding by remember { mutableStateOf(false) }
    var link by remember { mutableStateOf("") }
    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); vm.message.value = null } }

    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        val openInstagram = {
            val launch = context.packageManager.getLaunchIntentForPackage("com.instagram.android")
                ?: Intent(Intent.ACTION_VIEW, Uri.parse("https://www.instagram.com"))
            try { context.startActivity(launch) } catch (_: ActivityNotFoundException) { /* nothing to open */ }
        }
        val sampleToast = { android.widget.Toast.makeText(context, "This is a sample. Share a reel from Instagram to add your own.", android.widget.Toast.LENGTH_SHORT).show() }
        if (webViewAvailable()) {
            HomeWebScreen(
                state = state,
                clipboardLink = clipboardLink,
                actions = HomeActions(
                    onQuery = vm::setQuery, onSelectFolder = vm::selectFolder, onOpen = onOpen,
                    onSaveClipboard = { vm.saveClipboard(onOpen) }, onDismissClipboard = vm::dismissClipboard,
                    onAddByLink = { adding = true }, onOpenInstagram = openInstagram, onSampleClick = sampleToast,
                ),
                contentPadding = padding,
            )
        } else {
            HomeScreen(
                state = state,
                onQuery = vm::setQuery,
                onSelectFolder = vm::selectFolder,
                onOpen = onOpen,
                clipboardLink = clipboardLink,
                onSaveClipboard = { vm.saveClipboard(onOpen) },
                onDismissClipboard = vm::dismissClipboard,
                onAddByLink = { adding = true },
                onOpenInstagram = openInstagram,
                onSampleClick = sampleToast,
                contentPadding = padding,
            )
        }
    }
    if (adding) {
        AlertDialog(
            onDismissRequest = { adding = false },
            title = { Text("Add a reel link") },
            text = { PillField(link, { link = it }, "Paste an Instagram or Facebook link") },
            confirmButton = { TextButton(onClick = { vm.addByLink(link, onOpen); link = ""; adding = false }) { Text("Save") } },
            dismissButton = { TextButton(onClick = { adding = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun DetailRoute(id: Long, onBack: () -> Unit, vm: DetailViewModel = viewModel()) {
    val context = LocalContext.current
    val item by remember(id) { vm.observe(id) }.collectAsStateWithLifecycle(initialValue = null)
    val folders by vm.folders.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.messages.collect { android.widget.Toast.makeText(context, it, android.widget.Toast.LENGTH_SHORT).show() } }
    val current = item ?: return
    AskForNotificationsOnce(active = current.reel.remindAt != null)
    Scaffold { padding ->
        androidx.compose.foundation.layout.Box(Modifier.padding(padding)) {
            DetailScreen(
                item = current,
                folders = folders,
                onOpenOriginal = {
                    vm.opened(id)
                    try {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(current.reel.permalink)))
                    } catch (_: ActivityNotFoundException) { /* no browser installed */ }
                },
                onStatus = { vm.status(id, it) },
                onMove = { vm.move(id, it) },
                onNote = { vm.note(id, it) },
                onTitle = { vm.title(id, it) },
                onDescribe = { vm.describe(id, it) },
                onScreenshot = { uris -> vm.screenshot(id, uris) },
                onPasteCaption = { text -> vm.pasteCaption(id, text) },
                onOrganise = { vm.organise(id) },
                onEmbedAvailability = { vm.embedAvailability(id, it) },
                onEventDate = { vm.setEventDate(id, it) },
                onDelete = { vm.delete(id); onBack() },
            )
        }
    }
}

/** The first time a reel has a reminder, ask once for permission to show notifications (Android 13 and newer). */
@Composable
private fun AskForNotificationsOnce(active: Boolean) {
    val context = LocalContext.current
    val launcher = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(active) {
        val prefs = context.getSharedPreferences("reelbox", android.content.Context.MODE_PRIVATE)
        if (active && !Notifications.canNotify(context) && !prefs.getBoolean("asked_notifications", false)) {
            prefs.edit().putBoolean("asked_notifications", true).apply()
            launcher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
