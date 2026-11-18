package com.reelbox.app.domain

import com.reelbox.app.data.INBOX

enum class Confidence { HIGH, LOW }

data class Suggestion(val folder: String, val confidence: Confidence, val tags: List<String>)

/**
 * Rules-based auto-filing (predictable, free, no hallucination). Looks at the caption,
 * title and hashtags. Falls back to Inbox with LOW confidence when nothing matches.
 */
object Classifier {
    private val rules: Map<String, List<String>> = mapOf(
        "Recipes" to listOf(
            "recipe", "recipes", "ingredients", "cook", "cooking", "bake", "baking", "dinner", "lunch",
            "breakfast", "dessert", "paneer", "pasta", "curry", "dough", "tbsp", "tsp", "air fryer",
            "meal prep", "mealprep", "foodie", "recept", "koken", "bakken", "eten", "biryani", "dal",
        ),
        "Travel" to listOf(
            "travel", "trip", "hotel", "cafe", "hidden gem", "itinerary", "flight", "airport", "beach",
            "visit", "vacation", "holiday", "wanderlust", "hike", "hiking", "amsterdam", "dordrecht",
            "rotterdam", "paris", "reis", "vakantie", "citytrip", "backpacking",
        ),
        "Fashion" to listOf(
            "outfit", "grwm", "ootd", "style", "styling", "fashion", "wardrobe", "dress", "haul",
            "lookbook", "skincare", "makeup", "hair", "hairstyle", "haircare", "nails", "saree", "kleding",
        ),
        "Home" to listOf(
            "decor", "interior", "diy", "balcony", "apartment", "organize", "organising", "organizing",
            "cleaning", "ikea", "furniture", "garden", "makeover", "hometour", "woonkamer", "inrichting",
        ),
        "Motivation" to listOf(
            "motivation", "mindset", "habit", "habits", "workout", "gym", "fitness", "discipline",
            "productivity", "morning routine", "self improvement", "quotes", "yoga",
        ),
    )

    private val hashtagRegex = Regex("""#([\p{L}\p{N}_]+)""")
    private val wordRegex = Regex("""[\p{L}\p{N}]+""")

    fun hashtags(text: String): List<String> =
        hashtagRegex.findAll(text).map { it.groupValues[1].lowercase() }.distinct().toList()

    fun classify(title: String, caption: String): Suggestion {
        val text = "$title $caption".lowercase()
        val tags = hashtags(text)
        val words = wordRegex.findAll(text).map { it.value }.toSet()

        val scores = rules.mapValues { (_, keywords) ->
            keywords.sumOf { keyword ->
                val inWords = if (' ' in keyword) text.contains(keyword) else keyword in words
                val inTags = keyword.replace(" ", "") in tags
                (if (inWords) 1 else 0) + (if (inTags) 1 else 0)
            }
        }
        val ranked = scores.entries.sortedByDescending { it.value }
        val best = ranked.first()
        val secondScore = ranked.getOrNull(1)?.value ?: 0
        if (best.value == 0) return Suggestion(INBOX, Confidence.LOW, tags.take(5))

        val matchedKeywords = rules.getValue(best.key).filter { it in words || it in text }
        val chosenTags = (tags + matchedKeywords.map { it.replace(" ", "") }).distinct().take(5)
        val high = best.value >= 3 || (best.value >= 2 && best.value - secondScore >= 1)
        return Suggestion(best.key, if (high) Confidence.HIGH else Confidence.LOW, chosenTags)
    }
}
