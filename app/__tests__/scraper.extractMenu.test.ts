import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractBamcoData } from '../src/scraper/extractBamcoBlob'
import { buildVenueMenu, nyLocalToUtcIso } from '../src/scraper/buildMenu'

const FIX = join(import.meta.dir, 'fixtures/bonappetit')
function load(name: string): string {
    return readFileSync(join(FIX, name), 'utf8')
}

describe('buildVenueMenu', () => {
    it('builds a complete VenueMenu from real fixture data', () => {
        const html = load('1920-commons-2026-04-24.html')
        const data = extractBamcoData(html)!
        const menu = buildVenueMenu(data, {
            venueId: '1920-commons',
            venueName: '1920 Commons',
            date: '2026-04-24',
        })
        expect(menu.venueId).toBe('1920-commons')
        expect(menu.venueName).toBe('1920 Commons')
        expect(menu.date).toBe('2026-04-24')
        expect(menu.dayparts.length).toBeGreaterThan(0)
        const dp = menu.dayparts[0]!
        expect(['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Late Night', 'Snack']).toContain(dp.label)
        expect(dp.stations.length).toBeGreaterThan(0)
        expect(dp.stations[0]!.items.length).toBeGreaterThan(0)
        const item = dp.stations[0]!.items[0]!
        expect(item.name.length).toBeGreaterThan(0)
        expect(Array.isArray(item.tags)).toBe(true)
        expect(new Date(dp.startIso).toString()).not.toBe('Invalid Date')
    })

    it('normalizes lowercase Bamco labels to canonical capitalized labels', () => {
        const html = load('1920-commons-2026-04-24.html')
        const data = extractBamcoData(html)!
        const menu = buildVenueMenu(data, {
            venueId: '1920-commons',
            venueName: '1920 Commons',
            date: '2026-04-24',
        })
        for (const dp of menu.dayparts) {
            expect(dp.label).toBe(dp.label[0]!.toUpperCase() + dp.label.slice(1).toLowerCase().replace('night', 'Night'))
        }
    })

    it('skips empty stations', () => {
        const data = {
            menuItems: {},
            dayparts: [
                {
                    id: '1',
                    label: 'Lunch',
                    starttime: '11:00',
                    endtime: '14:00',
                    stations: [
                        { id: 's1', label: 'Grill', items: ['missing-id'] },
                    ],
                },
            ],
        }
        const menu = buildVenueMenu(data, { venueId: 'x', venueName: 'X', date: '2026-04-24' })
        expect(menu.dayparts[0]!.stations).toEqual([])
    })

    it('builds tags from cor_icon', () => {
        const data = {
            menuItems: {
                a1: {
                    id: 'a1',
                    label: 'Tofu Stir Fry',
                    cor_icon: { '4': 'Vegan', '1': 'Vegetarian' },
                },
            },
            dayparts: [
                {
                    id: '1',
                    label: 'Dinner',
                    starttime: '17:00',
                    endtime: '21:00',
                    stations: [{ id: 's1', label: 'Wok', items: ['a1'] }],
                },
            ],
        }
        const menu = buildVenueMenu(data, { venueId: 'x', venueName: 'X', date: '2026-04-24' })
        const item = menu.dayparts[0]!.stations[0]!.items[0]!
        expect(item.name).toBe('Tofu Stir Fry')
        expect(item.tags).toContain('vegan')
        expect(item.tags).toContain('vegetarian')
    })
})

describe('nyLocalToUtcIso', () => {
    it('converts NY EDT (UTC-4) summer time correctly', () => {
        expect(nyLocalToUtcIso('2026-07-15', '07:00')).toBe('2026-07-15T11:00:00.000Z')
        expect(nyLocalToUtcIso('2026-07-15', '21:30')).toBe('2026-07-16T01:30:00.000Z')
    })

    it('converts NY EST (UTC-5) winter time correctly', () => {
        expect(nyLocalToUtcIso('2026-01-15', '07:00')).toBe('2026-01-15T12:00:00.000Z')
    })
})
