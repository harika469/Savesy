package com.reelbox.app

import android.app.Application
import com.reelbox.app.data.AppDatabase
import com.reelbox.app.data.ReelRepository
import com.reelbox.app.domain.MetaOEmbedEnricher

class ReelboxApp : Application() {
    val repository: ReelRepository by lazy { ReelRepository(AppDatabase.create(this), MetaOEmbedEnricher()) }
}
