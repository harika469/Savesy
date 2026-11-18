package com.reelbox.app

import android.app.Application
import com.reelbox.app.data.AppDatabase
import com.reelbox.app.data.ReelRepository
import com.reelbox.app.domain.EdgeFunctionEnricher
import com.reelbox.app.domain.NoEnricher

class ReelboxApp : Application() {
    val repository: ReelRepository by lazy {
        val enricher = if (BuildConfig.SUPABASE_URL.isNotBlank() && BuildConfig.SUPABASE_ANON_KEY.isNotBlank())
            EdgeFunctionEnricher(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY) else NoEnricher
        ReelRepository(AppDatabase.create(this), enricher)
    }
}
