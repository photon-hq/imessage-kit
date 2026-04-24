import { describe, expect, it } from 'bun:test'
import type { VenueMenu } from '../src/scraper/types'
import { pickDaypart } from '../src/lib/pickDaypart'

const menu: VenueMenu = {
    venueId: '1920-commons',
    venueName: '1920 Commons',
    date: '2026-04-24',
    fetchedAt: '2026-04-24T10:00:00Z',
    dayparts: [
        {
            label: 'Breakfast',
            startIso: '2026-04-24T11:00:00Z', // 7:00 EDT
            endIso: '2026-04-24T14:30:00Z', // 10:30 EDT
            stations: [],
        },
        {
            label: 'Lunch',
            startIso: '2026-04-24T15:00:00Z', // 11:00 EDT
            endIso: '2026-04-24T19:00:00Z', // 15:00 EDT
            stations: [],
        },
        {
            label: 'Dinner',
            startIso: '2026-04-24T20:30:00Z', // 16:30 EDT
            endIso: '2026-04-25T01:30:00Z', // 21:30 EDT
            stations: [],
        },
    ],
}

describe('pickDaypart', () => {
    it('returns the active daypart when now is inside it', () => {
        const now = new Date('2026-04-24T16:00:00Z') // 12:00 EDT — lunch
        const dp = pickDaypart(menu, now)
        expect(dp?.label).toBe('Lunch')
    })

    it('returns the next daypart when between meals', () => {
        const now = new Date('2026-04-24T19:30:00Z') // 15:30 EDT — after lunch, before dinner
        const dp = pickDaypart(menu, now)
        expect(dp?.label).toBe('Dinner')
    })

    it('returns the first daypart when before any', () => {
        const now = new Date('2026-04-24T06:00:00Z') // 02:00 EDT
        const dp = pickDaypart(menu, now)
        expect(dp?.label).toBe('Breakfast')
    })

    it('returns null when all dayparts have ended', () => {
        const now = new Date('2026-04-25T02:00:00Z') // 22:00 EDT
        const dp = pickDaypart(menu, now)
        expect(dp).toBeNull()
    })

    it('returns null when menu has no dayparts', () => {
        const empty: VenueMenu = { ...menu, dayparts: [] }
        expect(pickDaypart(empty, new Date())).toBeNull()
    })
})
