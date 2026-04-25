import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractBamcoBlob, extractBamcoData } from '../src/scraper/extractBamcoBlob'

const FIX = join(import.meta.dir, 'fixtures/bonappetit')

function load(name: string): string {
    return readFileSync(join(FIX, name), 'utf8')
}

describe('extractBamcoData', () => {
    it('parses menu_items and dayparts from real HTML', () => {
        const html = load('1920-commons-2026-04-24.html')
        const data = extractBamcoData(html)
        expect(data).not.toBeNull()
        expect(Object.keys(data!.menuItems).length).toBeGreaterThan(10)
        expect(data!.dayparts.length).toBeGreaterThanOrEqual(2)
        const dp = data!.dayparts[0]!
        expect(dp.label.length).toBeGreaterThan(0)
        expect(dp.starttime).toMatch(/^\d{2}:\d{2}$/)
        expect(dp.stations.length).toBeGreaterThan(0)
    })

    it('handles the other fixtures', () => {
        for (const f of ['hill-house-2026-04-24.html', 'falk-kosher-2026-04-24.html']) {
            const data = extractBamcoData(load(f))
            expect(data).not.toBeNull()
            expect(Object.keys(data!.menuItems).length).toBeGreaterThan(0)
            expect(data!.dayparts.length).toBeGreaterThan(0)
        }
    })

    it('returns null when no Bamco assignment present', () => {
        expect(extractBamcoData('<html><body>no menu here</body></html>')).toBeNull()
    })

    it('ignores braces inside string literals', () => {
        const html = `<script>Bamco.menu_items = {"a":{"id":"a","label":"weird{name","cor_icon":{}}};</script>`
        const data = extractBamcoData(html)
        expect(data).not.toBeNull()
        expect(data!.menuItems['a']?.label).toBe('weird{name')
    })
})

describe('extractBamcoBlob', () => {
    it('returns a JSON string version of the data', () => {
        const html = load('1920-commons-2026-04-24.html')
        const blob = extractBamcoBlob(html)
        expect(blob).not.toBeNull()
        const parsed = JSON.parse(blob!)
        expect(parsed.menuItems).toBeDefined()
        expect(Array.isArray(parsed.dayparts)).toBe(true)
    })
})
