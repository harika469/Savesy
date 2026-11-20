package com.reelbox.app

import android.app.Application
import android.content.Context
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
    val repository: ReelRepository by lazy {
        val configured = BuildConfig.SUPABASE_URL.isNotBlank() && BuildConfig.SUPABASE_ANON_KEY.isNotBlank()
        val ai: AiOrganiser = if (configured) {
            val auth = AnonymousAuth(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY, PrefsSessionStore(this))
            SupabaseAiOrganiser(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY, auth)
        } else NoAiOrganiser
        val provider = if (BuildConfig.CAPTIONED_EMBED_IMPORT) CaptionedEmbedProvider() else MetaOEmbedProvider()
        ReelRepository(AppDatabase.create(this), provider, ai = ai)
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
