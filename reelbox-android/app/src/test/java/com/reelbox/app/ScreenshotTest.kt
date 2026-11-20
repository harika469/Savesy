package com.reelbox.app

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.background
import com.reelbox.app.data.EnrichState
import com.reelbox.app.data.FolderEntity
import com.reelbox.app.data.Platform
import com.reelbox.app.data.ReelEntity
import com.reelbox.app.data.ReelStatus
import com.reelbox.app.data.ReelWithFolder
import com.reelbox.app.data.SYSTEM_FOLDERS
import com.reelbox.app.domain.Confidence
import com.reelbox.app.ui.CaptureSheet
import com.reelbox.app.ui.CaptureUi
import com.reelbox.app.ui.DetailScreen
import com.reelbox.app.ui.HomeScreen
import com.reelbox.app.ui.HomeState
import com.reelbox.app.ui.ReelboxTheme
import com.reelbox.app.ui.statsOf
import com.reelbox.app.ui.visibleFolders
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** Renders the real Compose screens to PNGs (build/screenshots) so the UI can be reviewed without a device. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-xxhdpi")
class ScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val folders = SYSTEM_FOLDERS.mapIndexed { i, (n, e) -> FolderEntity(i + 1L, n, e, isSystem = true) }
    private fun f(name: String) = folders.first { it.name == name }
    private val now = 1_800_000_000_000L
    private val day = 86_400_000L

    private fun reel(id: Long, title: String, who: String, folder: String, tags: String, daysAgo: Long, platform: Platform = Platform.INSTAGRAM, status: ReelStatus = ReelStatus.NEW) =
        ReelWithFolder(
            ReelEntity(id, "https://www.instagram.com/reel/x$id/", "ig:x$id", platform, "x$id", title, who, null, "$title. Full caption goes here.", null, tags, null, status, f(folder).id, "", EnrichState.ENRICHED, false, now - daysAgo * day, null),
            f(folder),
        )

    private val reels = listOf(
        reel(1, "15-min Paneer Butter Masala", "@foodie_harika", "Recipes", "recipe,dinner", 0, status = ReelStatus.TO_TRY),
        reel(2, "Hidden Cafe in Amsterdam", "@wanderlust", "Travel", "amsterdam,cafe", 1),
        reel(3, "GRWM - Wedding Outfit", "@style_diary", "Fashion", "grwm,wedding", 2, Platform.FACEBOOK),
        reel(4, "15-min Home Workout", "@fit_daily", "Motivation", "workout", 3),
        reel(5, "Small Balcony Makeover", "@home.inspo", "Home", "decor", 10),
        reel(6, "Hair Oiling Routine", "@glowup", "Fashion", "haircare", 12, status = ReelStatus.TRIED),
    )

    private fun save(name: String) {
        rule.waitForIdle()
        val view = rule.activity.window.decorView
        val bmp = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bmp))
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Composable private fun Frame(content: @Composable () -> Unit) = ReelboxTheme { Box(Modifier.fillMaxSize().background(Color.White)) { content() } }

    @Test fun home() {
        val (all, week) = statsOf(reels, now)
        rule.setContent { Frame { HomeScreen(HomeState(reels, all, week, visibleFolders(folders, reels), null, ""), {}, {}, {}) } }
        save("home")
    }

    @Test fun homeEmpty() {
        rule.setContent { Frame { HomeScreen(HomeState(emptyList(), 0, 0, visibleFolders(folders, emptyList()), null, ""), {}, {}, {}, clipboardLink = "https://www.instagram.com/reel/DfHfFlIhjUI/") } }
        save("home-empty")
    }

    @Test fun detail() {
        rule.setContent { Frame { DetailScreen(reels[0], folders, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}) } }
        save("detail")
    }

    @Test fun detailManual() {
        val manual = reels[1].let { it.copy(reel = it.reel.copy(title = "Instagram reel", creatorHandle = null, caption = "", hashtags = "", enrichState = EnrichState.MANUAL, folderId = f("Inbox").id), folder = f("Inbox")) }
        rule.setContent { Frame { DetailScreen(manual, folders, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}) } }
        save("detail-manual")
    }

    @Test fun captureSheet() {
        rule.setContent {
            Frame {
                Box(Modifier.fillMaxSize().background(Color(0x99000000)), contentAlignment = Alignment.BottomCenter) {
                    CaptureSheet(CaptureUi.Saved(f("Inbox"), null, pending = false, manual = true), folders, {}, {}, {}, {}, {})
                }
            }
        }
        save("capture")
    }
}
