package com.reelbox.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.OutlinedTextField
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
import com.reelbox.app.ui.HomeScreen
import com.reelbox.app.ui.HomeViewModel
import com.reelbox.app.ui.ReelboxTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { ReelboxTheme { ReelboxNav() } }
    }
}

@Composable
private fun ReelboxNav() {
    val nav = rememberNavController()
    NavHost(nav, startDestination = "home") {
        composable("home") { HomeRoute(onOpen = { nav.navigate("reel/$it") }) }
        composable("reel/{id}", arguments = listOf(navArgument("id") { type = NavType.LongType })) { entry ->
            val id = entry.arguments!!.getLong("id")
            DetailRoute(id, onBack = { nav.popBackStack() })
        }
    }
}

@Composable
private fun HomeRoute(onOpen: (Long) -> Unit, vm: HomeViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var adding by remember { mutableStateOf(false) }
    var link by remember { mutableStateOf("") }
    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); vm.message.value = null } }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = { FloatingActionButton(onClick = { adding = true }) { Text("+") } },
    ) { padding ->
        HomeScreen(state, vm::setQuery, vm::selectFolder, onOpen, padding)
    }
    if (adding) {
        AlertDialog(
            onDismissRequest = { adding = false },
            title = { Text("Add by link") },
            text = { OutlinedTextField(link, { link = it }, placeholder = { Text("Paste an Instagram or Facebook reel link") }, singleLine = true) },
            confirmButton = { TextButton(onClick = { vm.addByLink(link); link = ""; adding = false }) { Text("Save") } },
            dismissButton = { TextButton(onClick = { adding = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun DetailRoute(id: Long, onBack: () -> Unit, vm: DetailViewModel = viewModel()) {
    val context = LocalContext.current
    val item by remember(id) { vm.observe(id) }.collectAsStateWithLifecycle(initialValue = null)
    val folders by vm.folders.collectAsStateWithLifecycle()
    val current = item ?: return
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
                onDelete = { vm.delete(id); onBack() },
            )
        }
    }
}
