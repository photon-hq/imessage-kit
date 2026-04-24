import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractBamcoBlob } from '../src/scraper/extractBamcoBlob'

const FIX = join(import.meta.dir, 'fixtures/bonappetit')

function load(name: string): string {
    return readFileSync(join(FIX, name), 'utf8')
}

describe('extractBamcoBlob', () => {
    it('extracts the Bamco object from real HTML', () => {
        const html = load('1920-commons-2026-04-24.html')
        const blob = extractBamcoBlob(html)
        expect(blob).not.toBeNull()
        expect(blob!.startsWith('{')).toBe(true)
        expect(blob!.endsWith('}')).toBe(true)
        expect(blob!.length).toBeGreaterThan(100)
    })

    it('returns a balanced brace string', () => {
        const html = load('1920-commons-2026-04-24.html')
        const blob = extractBamcoBlob(html)!
        let depth = 0
        let minDepth = Infinity
        for (const c of blob) {
            if (c === '{') depth++
            else if (c === '}') depth--
            minDepth = Math.min(minDepth, depth)
        }
        expect(depth).toBe(0)
        expect(minDepth).toBeGreaterThanOrEqual(0)
    })

    it('handles the other fixtures', () => {
        for (const f of ['hill-house-2026-04-24.html', 'falk-kosher-2026-04-24.html']) {
            const blob = extractBamcoBlob(load(f))
            expect(blob).not.toBeNull()
        }
    })

    it('returns null when no Bamco assignment present', () => {
        expect(extractBamcoBlob('<html><body>no menu here</body></html>')).toBeNull()
    })

    it('ignores braces inside string literals', () => {
        const html = `<script>window.Bamco = {"name":"a{b}c","items":{"x":1}};</script>`
        const blob = extractBamcoBlob(html)
        expect(blob).toBe('{"name":"a{b}c","items":{"x":1}}')
    })
})
