package com.reelbox.app.domain

import org.json.JSONObject

sealed interface AiResult {
    data class Success(val ai: ReelAi) : AiResult
    data object NotConfigured : AiResult
    /** The daily allowance is used up (per person or app-wide). */
    data object LimitReached : AiResult
    data object Offline : AiResult
    data class Failed(val reason: String) : AiResult
}

/** Turns text the user supplied (caption, scanned text, note) into structured information. */
interface AiOrganiser {
    suspend fun organise(text: String, creator: String?, folders: List<String>): AiResult
}

object NoAiOrganiser : AiOrganiser {
    override suspend fun organise(text: String, creator: String?, folders: List<String>) = AiResult.NotConfigured
}

data class Session(val accessToken: String, val expiresAtSeconds: Long)

interface SessionStore {
    fun load(): Session?
    fun save(session: Session?)
}

/**
 * Supabase anonymous sign-in: each install gets its own token without asking for an email or password.
 * The token is what lets the server count usage per person.
 */
class AnonymousAuth(
    private val baseUrl: String,
    private val anonKey: String,
    private val store: SessionStore,
    private val post: suspend (String, Map<String, String>, String) -> HttpResult = ::httpPost,
    private val nowSeconds: () -> Long = { System.currentTimeMillis() / 1000 },
) {
    suspend fun token(forceNew: Boolean = false): String? {
        val cached = store.load()
        if (!forceNew && cached != null && cached.expiresAtSeconds - 60 > nowSeconds()) return cached.accessToken
        val response = post("${baseUrl.trimEnd('/')}/auth/v1/signup", mapOf("apikey" to anonKey, "Content-Type" to "application/json"), "{}")
        if (response.code !in 200..299) return null
        return try {
            val json = JSONObject(response.body)
            val token = json.getString("access_token")
            store.save(Session(token, nowSeconds() + json.optLong("expires_in", 3600)))
            token
        } catch (_: Exception) { null }
    }
}

/** Calls the `organise` Supabase Edge Function. The AI key lives only on the server. */
class SupabaseAiOrganiser(
    private val baseUrl: String,
    private val anonKey: String,
    private val auth: AnonymousAuth,
    private val post: suspend (String, Map<String, String>, String) -> HttpResult = ::httpPost,
) : AiOrganiser {
    override suspend fun organise(text: String, creator: String?, folders: List<String>): AiResult {
        val body = JSONObject().apply {
            put("text", text)
            if (!creator.isNullOrBlank()) put("creator", creator)
            put("folders", org.json.JSONArray(folders))
        }.toString()
        suspend fun call(token: String) = post(
            "${baseUrl.trimEnd('/')}/functions/v1/organise",
            mapOf("apikey" to anonKey, "Authorization" to "Bearer $token", "Content-Type" to "application/json"),
            body,
        )
        var token = auth.token() ?: return AiResult.Offline
        var response = call(token)
        if (response.code == 401) {
            token = auth.token(forceNew = true) ?: return AiResult.Offline
            response = call(token)
        }
        return when {
            response.code in 200..299 -> try {
                ReelAi.fromJson(JSONObject(response.body).getJSONObject("result").toString())?.let { AiResult.Success(it) }
                    ?: AiResult.Failed("Unreadable answer")
            } catch (_: Exception) { AiResult.Failed("Unreadable answer") }
            response.code == 429 -> AiResult.LimitReached
            response.code == 0 || response.code >= 500 -> AiResult.Offline
            else -> AiResult.Failed("Server said ${response.code}")
        }
    }
}
