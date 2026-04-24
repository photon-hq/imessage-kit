import { describe, expect, it } from 'bun:test'
import { rankVenues } from '../src/lib/rank'
import type { VenueMenu } from '../src/scraper/types'

function menu(venueId: string, tags: string[][]): VenueMenu {
    return {
        venueId,
        venueName: venueId,
        date: '2026-04-24',
        fetchedAt: new Date().toISOString(),
        dayparts: [
            {
                label: 'Lunch',
                startIso: '2026-04-24T16:00:00Z',
                endIso: '2026-04-24T19:00:00Z',
                stations: tags.map((itemTags, i) => ({
                    name: `Station ${i}`,
                    items: [{ name: `Item ${i}`, tags: itemTags }],
                })),
            },
        ],
    }
}

describe('rankVenues', () => {
    it('ranks by base score when no data', () => {
        const menus = [menu('a', [['vegan']]), menu('b', [['halal']])]
        const ranked = rankVenues(menus, { dietaryRestrictions: [], affinities: [] }, [])
        expect(ranked).toHaveLength(2)
    })

    it('boosts venues with diet-matching items', () => {
        const menus = [menu('plain', [['none']]), menu('vegan-friendly', [['vegan']])]
        const ranked = rankVenues(
            menus,
            { dietaryRestrictions: ['vegan'], affinities: [] },
            []
        )
        expect(ranked[0]?.venueId).toBe('vegan-friendly')
    })

    it('filters out venues with zero diet-matching items', () => {
        const menus = [menu('plain', [['none']]), menu('kosher-only', [['kosher']])]
        const ranked = rankVenues(
            menus,
            { dietaryRestrictions: ['kosher'], affinities: [] },
            []
        )
        expect(ranked.map((r) => r.venueId)).toEqual(['kosher-only'])
    })

    it('rewards positive knowledge and penalizes negative', () => {
        const menus = [menu('good', [[]]), menu('bad', [[]])]
        const ranked = rankVenues(menus, { dietaryRestrictions: [], affinities: [] }, [
            { venueId: 'good', tags: ['positive'] },
            { venueId: 'bad', tags: ['negative'] },
            { venueId: 'bad', tags: ['negative'] },
        ])
        expect(ranked[0]?.venueId).toBe('good')
        expect(ranked[1]?.venueId).toBe('bad')
        expect(ranked[1]?.score).toBeLessThan(ranked[0]!.score)
    })

    it('breaks ties with affinity', () => {
        const menus = [menu('a', [[]]), menu('b', [[]])]
        const ranked = rankVenues(menus, { dietaryRestrictions: [], affinities: ['b'] }, [])
        expect(ranked[0]?.venueId).toBe('b')
    })
})
