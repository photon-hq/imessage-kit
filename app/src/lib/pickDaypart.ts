import type { Daypart, VenueMenu } from '../scraper/types'

export function pickDaypart(menu: VenueMenu, now: Date): Daypart | null {
    if (menu.dayparts.length === 0) return null
    const nowMs = now.getTime()
    const sorted = [...menu.dayparts].sort(
        (a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime()
    )
    for (const dp of sorted) {
        const start = new Date(dp.startIso).getTime()
        const end = new Date(dp.endIso).getTime()
        if (nowMs >= start && nowMs < end) return dp
    }
    for (const dp of sorted) {
        const start = new Date(dp.startIso).getTime()
        if (nowMs < start) return dp
    }
    return null
}
