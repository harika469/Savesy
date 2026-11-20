package com.reelbox.app

import com.reelbox.app.domain.DateExtractor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

class DateExtractorTest {
    private val today = LocalDate.of(2026, 11, 20)
    private fun next(text: String) = DateExtractor.next(text, today)?.date

    @Test fun dayThenMonthName() = assertEquals(LocalDate.of(2026, 12, 25), next("Christmas sale ends 25 December. Don't miss it"))

    @Test fun monthNameThenDayWithOrdinalAndYear() = assertEquals(LocalDate.of(2026, 12, 25), next("Join us on Dec 25th, 2026 for dinner"))

    @Test fun abbreviationsAndOrdinals() {
        assertEquals(LocalDate.of(2026, 12, 5), next("DECEMBER 5"))
        assertEquals(LocalDate.of(2027, 3, 5), next("the 5th of March"))
        assertEquals(LocalDate.of(2026, 12, 3), next("Opens 3 Dec"))
        assertEquals(LocalDate.of(2026, 12, 3), next("Opens 3 Sept 2026".replace("Sept 2026", "Dec")))
    }

    @Test fun numericFormatsAreDayFirst() {
        assertEquals(LocalDate.of(2026, 12, 25), next("25-12-2026"))
        assertEquals(LocalDate.of(2026, 12, 25), next("25/12/2026"))
        assertEquals(LocalDate.of(2026, 12, 25), next("25.12.26"))
        assertEquals(LocalDate.of(2026, 12, 25), next("2026-12-25"))
    }

    @Test fun dutchMonthNames() {
        assertEquals(LocalDate.of(2026, 12, 25), next("kerstmarkt op 25 december"))
        assertEquals(LocalDate.of(2027, 5, 1), next("1 mei"))
    }

    @Test fun aDateWithoutAYearMeansItsNextOccurrence() {
        assertEquals(LocalDate.of(2027, 11, 15), next("15 november"))   // already passed this year
        assertEquals(LocalDate.of(2026, 11, 20), next("20 november"))   // today still counts
        assertEquals(LocalDate.of(2027, 1, 2), next("2 Jan"))
    }

    @Test fun pastFarAndImpossibleDatesAreIgnored() {
        assertNull(next("1 January 2020"))
        assertNull(next("1 January 2031"))
        assertNull(next("31 February 2027"))
        assertNull(next("30 Feb"))
        assertNull(next("2026-13-40"))
    }

    @Test fun recipesAndChatterDoNotLookLikeDates() {
        listOf(
            "1/2 tsp salt and 3/4 cup flour", "Ready in 15 minutes", "2 tbsp oil", "Dec 2026", "you may help yourself", "serves 4-6 people",
            "cook for 10.30 minutes", "Follow @purna_recipes for more", "Step 1. Chop 2 onions", "15 min dinner #quickmeals",
        ).forEach { assertNull(it, next(it)) }
    }

    @Test fun severalDatesAreSortedAndTheSoonestIsPicked() {
        val text = "Opens 20 Dec, early bird until 3 Dec, closes 31 January"
        assertEquals(listOf(LocalDate.of(2026, 12, 3), LocalDate.of(2026, 12, 20), LocalDate.of(2027, 1, 31)), DateExtractor.find(text, today).map { it.date })
        assertEquals(LocalDate.of(2026, 12, 3), next(text))
    }

    @Test fun theSameDateWrittenTwiceIsReportedOnce() =
        assertEquals(1, DateExtractor.find("25 December 2026, that is 2026-12-25", today).size)

    @Test fun noTextNoDate() { assertNull(next("")); assertNull(next("No date in here at all")) }
}
