import type { Daypart, FoodItem, Station, VenueMenu } from './types'
import type { BamcoData, RawMenuItem } from './extractBamcoBlob'

export interface BuildMenuHints {
    venueId: string
    venueName: string
    date: string // YYYY-MM-DD (NY local)
}

const LABEL_NORMALIZE: Record<string, string> = {
    breakfast: 'Breakfast',
    brunch: 'Brunch',
    lunch: 'Lunch',
    dinner: 'Dinner',
    'late night': 'Late Night',
    'late-night': 'Late Night',
    snack: 'Snack',
}

function normalizeLabel(raw: string): string {
    const k = raw.trim().toLowerCase()
    return LABEL_NORMALIZE[k] ?? raw.trim()
}

function normalizeTag(label: string): string {
    const lower = label.toLowerCase().trim()
    if (lower === 'made without gluten containing ingredients') return 'no-gluten'
    return lower.replace(/[/]/g, '-').replace(/\s+/g, '-')
}

function tagsFromCorIcon(cor: Record<string, string> | undefined): string[] {
    if (!cor) return []
    const out: string[] = []
    for (const v of Object.values(cor)) {
        const n = normalizeTag(v)
        if (n && !out.includes(n)) out.push(n)
    }
    return out
}

function nyOffsetMinutes(epochMs: number): number {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        timeZoneName: 'longOffset',
    })
    const parts = fmt.formatToParts(new Date(epochMs))
    const off = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-05:00'
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(off)
    if (!m) return -300
    const sign = m[1] === '+' ? 1 : -1
    return sign * (parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10))
}

export function nyLocalToUtcIso(date: string, hhmm: string): string {
    const [y, mo, d] = date.split('-').map(Number)
    const [hh, mm] = hhmm.split(':').map(Number)
    if (!y || !mo || !d || hh === undefined || mm === undefined) {
        throw new Error(`Invalid date/time: ${date} ${hhmm}`)
    }
    const naive = Date.UTC(y, mo - 1, d, hh, mm, 0)
    const offsetMin = nyOffsetMinutes(naive)
    return new Date(naive - offsetMin * 60_000).toISOString()
}

function buildItem(raw: RawMenuItem | undefined): FoodItem | null {
    if (!raw || !raw.label) return null
    const item: FoodItem = {
        name: raw.label,
        tags: tagsFromCorIcon(raw.cor_icon),
    }
    if (raw.description) item.description = raw.description
    return item
}

export function buildVenueMenu(data: BamcoData, hints: BuildMenuHints): VenueMenu {
    const dayparts: Daypart[] = []
    for (const dp of data.dayparts) {
        const stations: Station[] = []
        for (const st of dp.stations ?? []) {
            const items: FoodItem[] = []
            for (const id of st.items ?? []) {
                const it = buildItem(data.menuItems[id])
                if (it) items.push(it)
            }
            if (items.length > 0) stations.push({ name: st.label, items })
        }
        dayparts.push({
            label: normalizeLabel(dp.label),
            startIso: nyLocalToUtcIso(hints.date, dp.starttime),
            endIso: nyLocalToUtcIso(hints.date, dp.endtime),
            stations,
        })
    }
    return {
        venueId: hints.venueId,
        venueName: hints.venueName,
        date: hints.date,
        dayparts,
        fetchedAt: new Date().toISOString(),
    }
}
