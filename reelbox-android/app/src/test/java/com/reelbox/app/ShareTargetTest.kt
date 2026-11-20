package com.reelbox.app

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Proves the manifest registers Reelbox for the intents Instagram and Facebook send when you tap Share. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ShareTargetTest {
    private fun targets(configure: Intent.() -> Unit): List<String> {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val intent = Intent(Intent.ACTION_SEND).apply(configure)
        return context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_ALL).map { it.activityInfo.name }
    }

    @Test fun plainTextShareOffersReelbox() {
        assertTrue(targets { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, "https://www.instagram.com/reel/DfHfFlIhjUI/") }
            .contains("com.reelbox.app.ShareActivity"))
    }

    @Test fun shareActivityIsExported() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val info = context.packageManager.getActivityInfo(android.content.ComponentName(context, ShareActivity::class.java), 0)
        assertTrue(info.exported)
    }
}
