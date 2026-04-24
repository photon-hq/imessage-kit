import { describe, expect, it } from 'bun:test'
import { createGeminiClient, getVenueMenu } from '../src/scraper'

const LIVE = process.env.DESCRIBE_LIVE === '1'
const GEMINI_KEY = process.env.GEMINI_API_KEY

const describeLive = LIVE && GEMINI_KEY ? describe : describe.skip

describeLive('live scraper (DESCRIBE_LIVE=1)', () => {
    it(
        'fetches a real 1920-commons menu for today',
        async () => {
            const today = new Date().toISOString().slice(0, 10)
            const client = createGeminiClient(GEMINI_KEY!)
            const menu = await getVenueMenu('1920-commons', today, { client })
            console.log(`[live] ${menu.venueName} ${menu.date}: ${menu.dayparts.length} dayparts`)
            expect(menu.venueId).toBe('1920-commons')
            expect(Array.isArray(menu.dayparts)).toBe(true)
            if (menu.dayparts.length > 0) {
                const dp = menu.dayparts[0]!
                expect(dp.label.length).toBeGreaterThan(0)
                expect(new Date(dp.startIso).toString()).not.toBe('Invalid Date')
            }
        },
        30_000,
    )
})
