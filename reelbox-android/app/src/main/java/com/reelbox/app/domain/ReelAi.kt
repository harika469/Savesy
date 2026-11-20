package com.reelbox.app.domain

import org.json.JSONArray
import org.json.JSONObject

/** What the AI step extracts from a caption, scanned text or note. Every list may be empty. */
data class ReelAi(
    val title: String,
    val summary: String,
    /** One of the user's folder names, or "Inbox" when unsure. */
    val category: String,
    val tags: List<String>,
    val ingredients: List<String>,
    val locations: List<String>,
    val products: List<String>,
    val suggestedActions: List<String>,
    val cookingTimeMinutes: Int?,
) {
    fun toJson(): String = JSONObject().apply {
        put("title", title); put("summary", summary); put("category", category)
        put("tags", JSONArray(tags)); put("ingredients", JSONArray(ingredients))
        put("locations", JSONArray(locations)); put("products", JSONArray(products))
        put("suggested_actions", JSONArray(suggestedActions))
        put("cooking_time_minutes", cookingTimeMinutes ?: JSONObject.NULL)
    }.toString()

    companion object {
        fun fromJson(json: String): ReelAi? = try {
            val o = JSONObject(json)
            fun list(name: String) = o.optJSONArray(name)?.let { a -> (0 until a.length()).map { a.optString(it).trim() }.filter { it.isNotEmpty() } } ?: emptyList()
            ReelAi(
                title = o.optString("title").trim(),
                summary = o.optString("summary").trim(),
                category = o.optString("category").trim().ifEmpty { "Inbox" },
                tags = list("tags"), ingredients = list("ingredients"), locations = list("locations"),
                products = list("products"), suggestedActions = list("suggested_actions"),
                cookingTimeMinutes = if (o.isNull("cooking_time_minutes")) null else o.optInt("cooking_time_minutes").takeIf { it > 0 },
            )
        } catch (_: Exception) { null }

        /** Human wording for the action ids the AI may suggest. */
        val actionLabels = mapOf(
            "create_shopping_list" to "Create a shopping list",
            "remind_to_cook" to "Remind me to cook it",
            "plan_trip" to "Add to a trip plan",
            "buy_later" to "Buy it later",
            "watch_later" to "Watch it later",
        )
    }
}
