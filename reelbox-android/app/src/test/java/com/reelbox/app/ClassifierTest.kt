package com.reelbox.app

import com.reelbox.app.domain.Classifier
import com.reelbox.app.domain.Confidence
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ClassifierTest {
    @Test fun recipeIsHighConfidence() {
        val s = Classifier.classify("15-min Paneer Butter Masala", "Easy dinner recipe! Ingredients below #recipe #dinner")
        assertEquals("Recipes", s.folder)
        assertEquals(Confidence.HIGH, s.confidence)
        assertTrue("recipe" in s.tags)
    }

    @Test fun travelCafeAmsterdam() {
        val s = Classifier.classify("Hidden Cafe in Amsterdam", "hidden gem for your next trip #amsterdam #cafe")
        assertEquals("Travel", s.folder)
        assertEquals(Confidence.HIGH, s.confidence)
    }

    @Test fun fashionOutfit() {
        assertEquals("Fashion", Classifier.classify("GRWM - Wedding Outfit", "#grwm #wedding #ootd").folder)
    }

    @Test fun dutchRecipe() {
        assertEquals("Recipes", Classifier.classify("", "Makkelijk recept om te koken #recept").folder)
    }

    @Test fun nothingMatchesFallsBackToInboxWithLowConfidence() {
        val s = Classifier.classify("Instagram reel", "")
        assertEquals("Inbox", s.folder)
        assertEquals(Confidence.LOW, s.confidence)
    }

    @Test fun singleWeakHitIsLowConfidence() {
        val s = Classifier.classify("", "so cute")
        assertEquals(Confidence.LOW, s.confidence)
        val one = Classifier.classify("", "my dress today")
        assertEquals("Fashion", one.folder)
        assertEquals(Confidence.LOW, one.confidence)
    }

    @Test fun tagsAreCappedAtFive() {
        assertEquals(5, Classifier.classify("", "#a #b #c #d #e #f #g recipe").tags.size)
    }

    @Test fun hashtagsHandleUnicodeAndDuplicates() {
        assertEquals(listOf("café", "reis"), Classifier.hashtags("#Café #reis #café"))
    }
}
