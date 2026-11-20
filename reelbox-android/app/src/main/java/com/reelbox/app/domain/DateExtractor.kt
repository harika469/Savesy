package com.reelbox.app.domain

import java.time.DateTimeException
import java.time.LocalDate

data class FoundDate(val date: LocalDate, val text: String)

/**
 * Finds dates written in a caption or note: "25 December", "Dec 25th 2026", "25-12-2026", "2026-12-25", Dutch month
 * names too. Built to avoid false alarms: "1/2 tsp", "15 minutes" and "Dec 2026" are not dates. A date without a
 * year means its next occurrence. Past dates are ignored. Everything it finds can be changed or removed by the user.
 */
object DateExtractor {
    private val months: Map<String, Int> = buildMap {
        val en = listOf("january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december")
        val nl = listOf("januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december")
        en.forEachIndexed { i, name -> put(name, i + 1); put(name.take(3), i + 1) }
        nl.forEachIndexed { i, name -> put(name, i + 1) }
        put("sept", 9); put("mrt", 3); put("okt", 10)
    }
    private val monthNames = months.keys.sortedByDescending { it.length }.joinToString("|")
    private const val ORDINAL = "(?:st|nd|rd|th|e|de|ste)?"

    private val iso = Regex("""(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)""")
    private val numeric = Regex("""(?<![\d/.\-])(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?!\d)""")
    private val dayMonth = Regex("""(?<!\d)(\d{1,2})$ORDINAL\s*(?:of\s+)?($monthNames)\b\.?(?:,?\s+(\d{4}))?""", RegexOption.IGNORE_CASE)
    private val monthDay = Regex("""\b($monthNames)\b\.?\s+(\d{1,2})$ORDINAL(?!\d)(?:,?\s+(\d{4}))?""", RegexOption.IGNORE_CASE)

    private fun build(year: Int?, month: Int, day: Int, today: LocalDate): LocalDate? = try {
        if (year != null) LocalDate.of(year, month, day)
        else LocalDate.of(today.year, month, day).let { if (it.isBefore(today)) LocalDate.of(today.year + 1, month, day) else it }
    } catch (_: DateTimeException) { null }

    fun find(text: String, today: LocalDate): List<FoundDate> {
        val found = mutableListOf<FoundDate>()
        fun add(date: LocalDate?, raw: String) {
            if (date != null && !date.isBefore(today) && !date.isAfter(today.plusYears(2))) found += FoundDate(date, raw.trim())
        }
        iso.findAll(text).forEach { m -> add(build(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt(), today), m.value) }
        numeric.findAll(text).forEach { m ->
            val year = m.groupValues[3].let { if (it.length == 2) 2000 + it.toInt() else it.toInt() }
            add(build(year, m.groupValues[2].toInt(), m.groupValues[1].toInt(), today), m.value) // day first, as in the Netherlands and India
        }
        dayMonth.findAll(text).forEach { m ->
            add(build(m.groupValues[3].toIntOrNull(), months.getValue(m.groupValues[2].lowercase()), m.groupValues[1].toInt(), today), m.value)
        }
        monthDay.findAll(text).forEach { m ->
            add(build(m.groupValues[3].toIntOrNull(), months.getValue(m.groupValues[1].lowercase()), m.groupValues[2].toInt(), today), m.value)
        }
        return found.distinctBy { it.date }.sortedBy { it.date }
    }

    /** The soonest upcoming date in the text, if any. */
    fun next(text: String, today: LocalDate): FoundDate? = find(text, today).firstOrNull()
}
