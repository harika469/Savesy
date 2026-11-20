package com.reelbox.app

import com.reelbox.app.domain.ReelAi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReelAiTest {
    private val sample = ReelAi(
        title = "Creamy Dahi Pyaz Sabzi", summary = "A quick curry.", category = "Recipes", tags = listOf("vegetarian", "quick"),
        ingredients = listOf("Onions", "Curd"), locations = emptyList(), products = emptyList(),
        suggestedActions = listOf("create_shopping_list"), cookingTimeMinutes = 15,
    )

    @Test fun roundTripsThroughJson() = assertEquals(sample, ReelAi.fromJson(sample.toJson()))

    @Test fun nullCookingTimeSurvives() {
        val none = sample.copy(cookingTimeMinutes = null)
        assertNull(ReelAi.fromJson(none.toJson())!!.cookingTimeMinutes)
    }

    @Test fun missingFieldsBecomeEmptyAndInbox() {
        val ai = ReelAi.fromJson("""{"title":"Only a title"}""")!!
        assertEquals("Only a title", ai.title)
        assertEquals("Inbox", ai.category)
        assertEquals(emptyList<String>(), ai.tags)
    }

    @Test fun garbageIsNullNotACrash() {
        assertNull(ReelAi.fromJson("not json"))
        assertNull(ReelAi.fromJson(""))
    }

    @Test fun everyActionIdHasALabel() {
        listOf("create_shopping_list", "remind_to_cook", "plan_trip", "buy_later", "watch_later").forEach { assertNotNull(it, ReelAi.actionLabels[it]) }
    }
}
