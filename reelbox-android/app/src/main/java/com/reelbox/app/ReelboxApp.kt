package com.reelbox.app

import android.app.Application
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import com.reelbox.app.data.EnrichOutcome
import kotlinx.coroutines.Deferred
import com.reelbox.app.data.AppDatabase
import com.reelbox.app.data.ReelRepository
import com.reelbox.app.domain.AiOrganiser
import com.reelbox.app.domain.AnonymousAuth
import com.reelbox.app.domain.MetaOEmbedProvider
import com.reelbox.app.domain.CaptionedEmbedProvider
import com.reelbox.app.domain.NoAiOrganiser
import com.reelbox.app.domain.Session
import com.reelbox.app.domain.SessionStore
import com.reelbox.app.domain.SupabaseAiOrganiser

class ReelboxApp : Application() {
    private val importScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val imports = mutableMapOf<Long, Deferred<EnrichOutcome?>>()

    @Synchronized fun importReel(id: Long): Deferred<EnrichOutcome?> {
        imports[id]?.takeIf { it.isActive }?.let { return it }
        val job = importScope.async {
            val result = repository.enrich(id)
            repository.organiseWithAi(id)
            result
        }
        imports[id] = job
        job.invokeOnCompletion { synchronized(this) { if (imports[id] === job) imports.remove(id) } }
        return job
    }

    val repository: ReelRepository by lazy {
        val configured = BuildConfig.SUPABASE_URL.isNotBlank() && BuildConfig.SUPABASE_ANON_KEY.isNotBlank()
        val ai: AiOrganiser = if (configured) {
            val auth = AnonymousAuth(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY, PrefsSessionStore(this))
            SupabaseAiOrganiser(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY, auth)
        } else NoAiOrganiser
        val provider = if (BuildConfig.CAPTIONED_EMBED_IMPORT) CaptionedEmbedProvider() else MetaOEmbedProvider()
        ReelRepository(AppDatabase.create(this), provider, ai = ai, scheduler = WorkReminderScheduler(this))
    }
}

private class PrefsSessionStore(context: Context) : SessionStore {
    private val prefs = context.getSharedPreferences("supabase_session", Context.MODE_PRIVATE)
    override fun load(): Session? {
        val token = prefs.getString("token", null) ?: return null
        return Session(token, prefs.getLong("expires", 0))
    }
    override fun save(session: Session?) {
        prefs.edit().apply {
            if (session == null) clear() else { putString("token", session.accessToken); putLong("expires", session.expiresAtSeconds) }
        }.apply()
    }
}
