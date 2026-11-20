package com.reelbox.app

import com.reelbox.app.domain.AiResult
import com.reelbox.app.domain.AnonymousAuth
import com.reelbox.app.domain.HttpResult
import com.reelbox.app.domain.Session
import com.reelbox.app.domain.SessionStore
import com.reelbox.app.domain.SupabaseAiOrganiser
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private class MemoryStore : SessionStore {
    var session: Session? = null
    override fun load() = session
    override fun save(session: Session?) { this.session = session }
}

private class Call(val url: String, val headers: Map<String, String>, val body: String)

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SupabaseAiOrganiserTest {
    private val answer = """{"result":{"title":"T","summary":"S","category":"Recipes","tags":["a"],"ingredients":["x"],"locations":[],"products":[],"suggested_actions":[],"cooking_time_minutes":15}}"""
    private val calls = mutableListOf<Call>()
    private var tokens = 0
    private var now = 1_000L

    private fun organiser(store: MemoryStore = MemoryStore(), function: (Int) -> HttpResult = { HttpResult(200, answer) }, signup: () -> HttpResult? = { null }): SupabaseAiOrganiser {
        var functionCalls = 0
        val post: suspend (String, Map<String, String>, String) -> HttpResult = { url, headers, body ->
            calls += Call(url, headers, body)
            if (url.endsWith("/auth/v1/signup")) {
                signup() ?: HttpResult(200, """{"access_token":"token-${++tokens}","expires_in":3600}""")
            } else function(++functionCalls)
        }
        val auth = AnonymousAuth("https://p.supabase.co/", "anon", store, post, nowSeconds = { now })
        return SupabaseAiOrganiser("https://p.supabase.co/", "anon", auth, post)
    }

    private suspend fun SupabaseAiOrganiser.run() = organise("Easy dinner recipe with paneer", "@foodie", listOf("Inbox", "Recipes"))

    @Test fun signsInAnonymouslyThenCallsTheFunctionWithTheUsersToken() = runBlocking {
        val result = organiser().run()
        assertTrue(result is AiResult.Success)
        assertEquals("Recipes", (result as AiResult.Success).ai.category)
        assertEquals(2, calls.size)
        assertEquals("https://p.supabase.co/auth/v1/signup", calls[0].url)
        assertEquals("https://p.supabase.co/functions/v1/organise", calls[1].url)
        assertEquals("Bearer token-1", calls[1].headers["Authorization"])
        assertEquals("anon", calls[1].headers["apikey"])
        assertTrue(calls[1].body, "\"folders\":[\"Inbox\",\"Recipes\"]" in calls[1].body && "\"creator\":\"@foodie\"" in calls[1].body)
    }

    @Test fun theSignInTokenIsReusedUntilItExpires() = runBlocking {
        val o = organiser()
        o.run(); o.run()
        assertEquals(1, calls.count { it.url.endsWith("/signup") })
        now += 4000
        o.run()
        assertEquals(2, calls.count { it.url.endsWith("/signup") })
    }

    @Test fun anExpiredTokenIsReplacedAndTheCallRetriedOnce() = runBlocking {
        val result = organiser(function = { n -> if (n == 1) HttpResult(401, "") else HttpResult(200, answer) }).run()
        assertTrue(result is AiResult.Success)
        assertEquals(2, calls.count { it.url.endsWith("/signup") })
        assertEquals("Bearer token-2", calls.last().headers["Authorization"])
    }

    @Test fun errorsMapToTheRightOutcome() = runBlocking {
        assertEquals(AiResult.LimitReached, organiser(function = { HttpResult(429, "") }).run())
        assertEquals(AiResult.Offline, organiser(function = { HttpResult(0, "") }).run())
        assertEquals(AiResult.Offline, organiser(function = { HttpResult(503, "") }).run())
        assertTrue(organiser(function = { HttpResult(400, "") }).run() is AiResult.Failed)
        assertTrue(organiser(function = { HttpResult(200, "<html>") }).run() is AiResult.Failed)
    }

    @Test fun failingToSignInMeansOffline() = runBlocking {
        assertEquals(AiResult.Offline, organiser(signup = { HttpResult(0, "") }).run())
        assertEquals(1, calls.size)
    }
}
