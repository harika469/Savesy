package com.reelbox.app

import android.app.Application
import com.reelbox.app.data.AppDatabase
import com.reelbox.app.data.ReelRepository
import com.reelbox.app.domain.NoEnricher

class ReelboxApp : Application() {
    // Meta's tokenless oEmbed returns no caption/creator/thumbnail, so details come from what the user says.
    // Swap in MetaOEmbedEnricher(...) once a token with oEmbed Read access exists.
    val repository: ReelRepository by lazy { ReelRepository(AppDatabase.create(this), NoEnricher) }
}
