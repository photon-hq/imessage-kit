import { describe, expect, it, mock } from 'bun:test'
import { fetchVenueHtml } from '../src/scraper/fetcher'

describe('fetchVenueHtml', () => {
    it('builds the correct URL and returns HTML on 200', async () => {
        const stub = mock(async (url: string) => {
            expect(url).toBe('https://university-of-pennsylvania.cafebonappetit.com/cafe/hill-house/?date=2026-04-24')
            return new Response('<html>ok</html>', { status: 200 })
        })
        const html = await fetchVenueHtml('hill-house', '2026-04-24', { fetchImpl: stub as unknown as typeof fetch })
        expect(html).toContain('ok')
        expect(stub).toHaveBeenCalledTimes(1)
    })

    it('throws on non-200', async () => {
        const stub = mock(async () => new Response('nope', { status: 503 }))
        await expect(
            fetchVenueHtml('hill-house', '2026-04-24', { fetchImpl: stub as unknown as typeof fetch })
        ).rejects.toThrow(/503/)
    })

    it('sends a User-Agent', async () => {
        let seenHeaders: Headers | undefined
        const stub = mock(async (_url: string, init?: RequestInit) => {
            seenHeaders = new Headers(init?.headers)
            return new Response('<html></html>', { status: 200 })
        })
        await fetchVenueHtml('hill-house', '2026-04-24', { fetchImpl: stub as unknown as typeof fetch })
        expect(seenHeaders?.get('user-agent')).toMatch(/PennEats/)
    })
})
