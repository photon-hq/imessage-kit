import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getVenueMenu } from '../src/scraper'

const html = readFileSync(
    join(import.meta.dir, 'fixtures/bonappetit/1920-commons-2026-04-24.html'),
    'utf8'
)

describe('getVenueMenu', () => {
    it('composes fetch + extract + build into a real VenueMenu', async () => {
        const fetchStub = async () => new Response(html, { status: 200 })
        const menu = await getVenueMenu('1920-commons', '2026-04-24', {
            fetchImpl: fetchStub as unknown as typeof fetch,
        })
        expect(menu.venueName).toBe('1920 Commons')
        expect(menu.dayparts.length).toBeGreaterThan(0)
        const dp = menu.dayparts[0]!
        expect(dp.stations.length).toBeGreaterThan(0)
        expect(dp.stations[0]!.items.length).toBeGreaterThan(0)
    })

    it('throws for unknown venue id', async () => {
        await expect(getVenueMenu('not-a-venue', '2026-04-24')).rejects.toThrow(/unknown venue/i)
    })

    it('returns an empty-dayparts menu if no Bamco data present', async () => {
        const fetchStub = async () => new Response('<html>no bamco</html>', { status: 200 })
        const menu = await getVenueMenu('1920-commons', '2026-04-24', {
            fetchImpl: fetchStub as unknown as typeof fetch,
        })
        expect(menu.dayparts).toEqual([])
    })
})
