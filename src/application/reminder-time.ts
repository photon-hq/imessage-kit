/**
 * Natural language time parsing for reminders.
 *
 * Pure functions that convert human-friendly time expressions
 * into absolute Date objects.
 */

// -----------------------------------------------
// Constants
// -----------------------------------------------

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

// -----------------------------------------------
// Duration parsing
// -----------------------------------------------

/**
 * Parse a human-readable duration string into milliseconds.
 *
 * Supports: "5 seconds", "10 minutes", "2 hours", "1 day", "3 weeks"
 */
export function parseDuration(duration: string): number {
    const match = duration.toLowerCase().match(/^(\d+)\s*(second|minute|hour|day|week)s?$/)

    if (!match) {
        throw new Error(`Invalid duration format: "${duration}". Use formats like "5 minutes", "2 hours", "1 day"`)
    }

    const rawValue = match[1]
    const rawUnit = match[2]

    if (!rawValue || !rawUnit) {
        throw new Error(`Invalid duration format: "${duration}". Use formats like "5 minutes", "2 hours", "1 day"`)
    }

    const value = Number.parseInt(rawValue, 10)

    const multipliers: Record<string, number> = {
        second: 1_000,
        minute: 60_000,
        hour: 3_600_000,
        day: 86_400_000,
        week: 604_800_000,
    }

    const mult = multipliers[rawUnit]

    if (mult === undefined) {
        throw new Error(`Invalid duration unit: "${rawUnit}"`)
    }

    return value * mult
}

// -----------------------------------------------
// Time-of-day parsing
// -----------------------------------------------

function parseTime(timeStr: string): { hours: number; minutes: number } {
    const trimmed = timeStr.trim()

    // 24-hour format: "17:30"
    const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/)

    if (match24) {
        const hours = Number.parseInt(match24[1] as string, 10)
        const minutes = Number.parseInt(match24[2] as string, 10)

        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            throw new Error(`Invalid time: "${timeStr}". Hours must be 0-23 and minutes 0-59 for 24-hour format`)
        }

        return { hours, minutes }
    }

    // 12-hour format: "5pm", "5:30pm", "5:30 pm"
    const match12 = trimmed.toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)

    if (match12) {
        let hours = Number.parseInt(match12[1] as string, 10)
        const minutes = match12[2] ? Number.parseInt(match12[2], 10) : 0
        const period = match12[3]

        if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
            throw new Error(`Invalid time: "${timeStr}". Hours must be 1-12 and minutes 0-59 for 12-hour format`)
        }

        if (period === 'pm' && hours !== 12) hours += 12
        if (period === 'am' && hours === 12) hours = 0

        return { hours, minutes }
    }

    throw new Error(`Invalid time format: "${timeStr}". Use formats like "5pm", "5:30pm", "17:30"`)
}

// -----------------------------------------------
// At-expression parsing
// -----------------------------------------------

/**
 * Parse a natural language "at" expression into an absolute Date.
 *
 * Supports:
 *   - Time only: "5pm", "17:30"
 *   - Tomorrow: "tomorrow 9am"
 *   - Weekday: "monday 10:00", "friday 5pm"
 *
 * If the resulting time is in the past, advances to the next occurrence.
 */
export function parseAtExpression(expression: string, now = new Date()): Date {
    const parts = expression.toLowerCase().trim().split(/\s+/)
    const targetDate = new Date(now)
    let timeStr: string
    let isWeekdayExpression = false

    if (parts.length === 1) {
        const only = parts[0]

        if (!only) {
            throw new Error(`Invalid at expression: "${expression}"`)
        }

        timeStr = only
    } else if (parts[0] === 'tomorrow') {
        targetDate.setDate(targetDate.getDate() + 1)
        timeStr = parts.slice(1).join(' ')
    } else if (WEEKDAYS.includes(parts[0] as (typeof WEEKDAYS)[number])) {
        isWeekdayExpression = true
        const targetDay = WEEKDAYS.indexOf(parts[0] as (typeof WEEKDAYS)[number])
        const currentDay = now.getDay()
        const rawDiff = targetDay - currentDay
        const daysUntil = rawDiff < 0 ? rawDiff + 7 : rawDiff

        targetDate.setDate(targetDate.getDate() + daysUntil)
        timeStr = parts.slice(1).join(' ')
    } else {
        timeStr = expression
    }

    const { hours, minutes } = parseTime(timeStr)
    targetDate.setHours(hours, minutes, 0, 0)

    if (targetDate <= now) {
        targetDate.setDate(targetDate.getDate() + (isWeekdayExpression ? 7 : 1))
    }

    return targetDate
}
