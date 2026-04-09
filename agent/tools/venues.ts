/**
 * Venue & menu data tools.
 *
 * Data sources:
 *  1. Bon Appétit HTML pages — open/closed status, daypart hours, and menu items
 *     (parsed from embedded Bamco.* JS variables)
 *
 * Note: Penn Dining's /api/dining/venues/ REST endpoint was removed in early 2026.
 * We now derive venue status from the same Bon Appétit pages used for menus.
 *
 * Edge cases handled:
 *  - Venues without a Bon Appétit slug → returned with status 'unknown'
 *  - Daypart labels vary by day (Brunch on weekends, Breakfast+Lunch on weekdays, etc.)
 *  - Fetch failures → returned with status 'unknown', logged silently
 *  - Schedules change week to week — always use live pages, never hardcode hours
 */

import { BON_APP_BASE, VENUES, findVenue } from '../config.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Daypart {
    label: string
    startTime: string
    endTime: string
    /** ISO strings preserved for scheduling follow-ups */
    startIso: string
    endIso: string
    isCurrent: boolean
    /** True if the meal hasn't ended yet (may not have started) */
    isUpcoming: boolean
    /** Notes from Penn Dining (Shabbat, reservation required, meal exchange info, etc.) */
    note: string | null
}

export interface VenueStatus {
    pennDiningId: number
    name: string
    address: string
    venueType: string
    /** "open" | "closed" | "unknown" — "unknown" when status field is empty */
    status: 'open' | 'closed' | 'unknown'
    isServingNow: boolean
    dayparts: Daypart[]
    currentDaypart: Daypart | null
    nextDaypart: Daypart | null
}

export interface MenuItem {
    id: string
    label: string
    calories: string | null
    dietary: string[]
}

export interface MenuStation {
    label: string
    items: MenuItem[]
}

export interface VenueMenu {
    venue: string
    date: string
    mealPeriod: string
    stations: MenuStation[]
    allItems: MenuItem[]
}

// ---------------------------------------------------------------------------
// Bon Appétit — venue hours (replaces defunct Penn Dining REST API)
// ---------------------------------------------------------------------------

function toLocalDateString(date: Date): string {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

function formatTime(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

/**
 * Scrape a single venue's status and daypart hours from its Bon Appétit page.
 * Returns null on fetch failure so the caller can gracefully degrade.
 */
async function fetchVenueStatus(
    slug: string,
    date: string,
    now: Date
): Promise<{ status: 'open' | 'closed' | 'unknown'; dayparts: Daypart[] } | null> {
    try {
        const url = `${BON_APP_BASE}/${slug}/?date=${date}`
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PennDiningBot/1.0)' },
        })
        if (!res.ok) return null
        const html = await res.text()

        // Derive open/closed from the CSS class injected by Bon Appétit
        const statusMatch = html.match(/site-panel__cafeinfo-currently--(\w+)/)
        const rawStatus = statusMatch?.[1] ?? ''
        const status: 'open' | 'closed' | 'unknown' =
            rawStatus === 'open' ? 'open' : rawStatus === 'closed' ? 'closed' : 'unknown'

        // Reuse the existing daypart parser (Bamco.dayparts JS variable)
        const daypartsById = parseDayparts(html)

        const dayparts: Daypart[] = Object.values(daypartsById).map((dp): Daypart => {
            // Bamco starttime/endtime are "HH:MM:SS" — combine with date for full ISO
            const startIso = new Date(`${date}T${dp.starttime}`).toISOString()
            const endIso = new Date(`${date}T${dp.endtime}`).toISOString()
            const start = new Date(startIso)
            const end = new Date(endIso)
            const isCurrent = now >= start && now <= end
            const isUpcoming = now < end

            return {
                label: dp.label,
                startTime: formatTime(startIso),
                endTime: formatTime(endIso),
                startIso,
                endIso,
                isCurrent,
                isUpcoming,
                note: null,
            }
        })

        return { status, dayparts }
    } catch {
        return null
    }
}

/**
 * Fetch all venue statuses for today (or a specific date) from Bon Appétit.
 * Venues without a Bon Appétit slug are returned with status 'unknown'.
 * All requests run in parallel.
 */
export async function getVenuesToday(dateStr?: string): Promise<VenueStatus[]> {
    const date = dateStr ?? toLocalDateString(new Date())
    const now = new Date()

    return Promise.all(
        VENUES.map(async (config): Promise<VenueStatus> => {
            const scraped = config.bonAppetitSlug
                ? await fetchVenueStatus(config.bonAppetitSlug, date, now)
                : null

            const status = scraped?.status ?? 'unknown'
            const dayparts = scraped?.dayparts ?? []
            const currentDaypart = dayparts.find((dp) => dp.isCurrent) ?? null
            const nextDaypart = dayparts.find((dp) => !dp.isCurrent && dp.isUpcoming) ?? null

            return {
                pennDiningId: config.pennDiningId,
                name: config.name,
                address: config.address,
                venueType: config.type,
                status,
                isServingNow: currentDaypart !== null,
                dayparts,
                currentDaypart,
                nextDaypart,
            }
        })
    )
}

// ---------------------------------------------------------------------------
// Bon Appétit HTML scraper — menu items
// ---------------------------------------------------------------------------

/**
 * Extract the JSON object starting at `startPos` (the opening `{`) from html.
 * Uses brace-counting instead of a regex terminator to handle any nesting depth.
 * Bon Appétit pages wrap all Bamco.* assignments in a self-executing function,
 * so regex anchors like `;\s*(?:Bamco|<\/script>)` no longer work.
 */
function extractJsonObject(html: string, startPos: number): string | null {
    let depth = 0
    for (let i = startPos; i < html.length; i++) {
        if (html[i] === '{') depth++
        else if (html[i] === '}') {
            depth--
            if (depth === 0) return html.slice(startPos, i + 1)
        }
    }
    return null
}

function parseMenuItems(html: string): Record<string, MenuItem> {
    const re = /Bamco\.menu_items\s*=\s*\{/
    const m = re.exec(html)
    if (!m) return {}

    const json = extractJsonObject(html, m.index + m[0].length - 1)
    if (!json) return {}

    let raw: Record<string, unknown>
    try {
        raw = JSON.parse(json)
    } catch {
        return {}
    }

    const items: Record<string, MenuItem> = {}
    for (const [id, data] of Object.entries(raw)) {
        const d = data as Record<string, unknown>
        const dietary: string[] = []
        const labels = d['labels'] as Record<string, unknown> | null
        if (labels) {
            if (labels['vegan']) dietary.push('vegan')
            else if (labels['vegetarian']) dietary.push('vegetarian')
            if (labels['halal']) dietary.push('halal')
            if (labels['kosher']) dietary.push('kosher')
            if (labels['jain']) dietary.push('jain')
            if (labels['gluten']) dietary.push('gluten-free')
        }
        items[id] = {
            id,
            label: String(d['label'] ?? '').toLowerCase().trim(),
            calories: d['calories'] ? String(d['calories']) : null,
            dietary,
        }
    }
    return items
}

interface BamcoDaypart {
    id: string
    label: string
    starttime: string
    endtime: string
    stations: Array<{ id: string; label: string; items: string[] }>
}

function parseDayparts(html: string): Record<string, BamcoDaypart> {
    const result: Record<string, BamcoDaypart> = {}
    const re = /Bamco\.dayparts\['([^']+)'\]\s*=\s*\{/g
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null) {
        const json = extractJsonObject(html, m.index + m[0].length - 1)
        if (!json) continue
        try {
            result[m[1]!] = JSON.parse(json) as BamcoDaypart
        } catch {
            // skip malformed
        }
    }
    return result
}

/**
 * Fetch actual menu items for a venue from Bon Appétit's HTML.
 * Returns null if the venue has no Bon Appétit page or the fetch fails.
 *
 * mealPeriod matching is fuzzy — "lunch", "Lunch", "brunch", "Brunch" all work.
 * If omitted, picks the currently active period, then the first available.
 */
export async function getVenueMenu(
    venueName: string,
    dateStr?: string,
    mealPeriod?: string
): Promise<VenueMenu | null> {
    const config = findVenue(venueName)
    if (!config?.bonAppetitSlug) return null

    const date = dateStr ?? toLocalDateString(new Date())
    const url = `${BON_APP_BASE}/${config.bonAppetitSlug}/?date=${date}`

    let html: string
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PennDiningBot/1.0)' },
        })
        if (!res.ok) return null
        html = await res.text()
    } catch {
        return null
    }

    const allItemsById = parseMenuItems(html)
    const daypartsById = parseDayparts(html)

    // If no dayparts at all, nothing to show
    if (Object.keys(daypartsById).length === 0) return null

    const mealLower = mealPeriod?.toLowerCase().trim()
    const now = new Date()

    // Priority: exact label match → current time window → first upcoming → first ever
    let targetDaypart: BamcoDaypart | undefined

    if (mealLower) {
        targetDaypart = Object.values(daypartsById).find((dp) =>
            dp.label.toLowerCase().includes(mealLower)
        )
    }

    if (!targetDaypart) {
        // Find currently active
        targetDaypart = Object.values(daypartsById).find((dp) => {
            const start = new Date(`${date}T${dp.starttime}`)
            const end = new Date(`${date}T${dp.endtime}`)
            return now >= start && now <= end
        })
    }

    if (!targetDaypart) {
        // Find next upcoming
        targetDaypart = Object.values(daypartsById)
            .filter((dp) => new Date(`${date}T${dp.endtime}`) > now)
            .sort((a, b) =>
                new Date(`${date}T${a.starttime}`).getTime() -
                new Date(`${date}T${b.starttime}`).getTime()
            )[0]
    }

    // Final fallback: first daypart in list
    if (!targetDaypart) {
        targetDaypart = Object.values(daypartsById)[0]
    }

    if (!targetDaypart) return null

    const stations: MenuStation[] = targetDaypart.stations
        .map((station) => ({
            label: station.label,
            items: station.items
                .map((id) => allItemsById[id])
                .filter((item): item is MenuItem => !!item && !!item.label),
        }))
        .filter((s) => s.items.length > 0)

    const allItems = stations.flatMap((s) => s.items)

    return {
        venue: config.name,
        date,
        mealPeriod: targetDaypart.label,
        stations,
        allItems,
    }
}

// ---------------------------------------------------------------------------
// Formatting helpers for LLM context
// ---------------------------------------------------------------------------

/**
 * Format a VenueStatus as concise text for the LLM.
 * Includes daypart notes (Shabbat, reservations, etc.).
 */
export function formatVenueStatus(v: VenueStatus): string {
    if (v.dayparts.length === 0) {
        // No daypart data at all — either no Bon Appétit page or truly no service
        if (v.status === 'closed') return `${v.name}: Closed`
        return `${v.name}: No schedule available`
    }

    // For future dates status is 'unknown' (no live badge), but dayparts are available
    const statusLabel =
        v.status === 'closed' ? ' (currently closed)' :
        v.status === 'open' ? ' (currently open)' : ''
    const lines: string[] = [`${v.name}${statusLabel}${v.address ? ` (${v.address})` : ''}:`]

    for (const dp of v.dayparts) {
        const marker = dp.isCurrent ? ' ← now open' : !dp.isUpcoming ? ' (ended)' : ''
        lines.push(`  ${dp.label}: ${dp.startTime}–${dp.endTime}${marker}`)
        if (dp.note) {
            const firstLine = dp.note.split(/\r?\n/)[0]!.trim()
            if (firstLine) lines.push(`    ℹ️ ${firstLine}`)
        }
    }

    return lines.join('\n')
}

/**
 * Format a VenueMenu as concise text for the LLM.
 */
export function formatMenu(menu: VenueMenu): string {
    const lines: string[] = [`${menu.venue} — ${menu.mealPeriod} menu (${menu.date}):`]
    for (const station of menu.stations) {
        lines.push(`  [${station.label}]`)
        for (const item of station.items) {
            const tags = item.dietary.length ? ` (${item.dietary.join(', ')})` : ''
            lines.push(`    • ${item.label}${tags}`)
        }
    }
    return lines.join('\n')
}
