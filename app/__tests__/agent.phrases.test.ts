import { describe, expect, it } from 'bun:test'
import { PHRASES, pickPhrase } from '../src/agent/prompts/phrases'

describe('phrase library', () => {
    it('has non-empty pools for every declared step', () => {
        for (const [step, pool] of Object.entries(PHRASES)) {
            expect(pool.length).toBeGreaterThanOrEqual(3)
            for (const p of pool) expect(p.length).toBeGreaterThan(0)
            void step
        }
    })

    it('pickPhrase is deterministic per (userId, step)', () => {
        const a1 = pickPhrase('+14155550123', 'greet')
        const a2 = pickPhrase('+14155550123', 'greet')
        expect(a1).toBe(a2)
    })

    it('different users can get different phrases for the same step', () => {
        const variants = new Set<string>()
        for (let i = 0; i < 30; i++) {
            variants.add(pickPhrase(`+1415555${String(i).padStart(4, '0')}`, 'greet'))
        }
        expect(variants.size).toBeGreaterThan(1)
    })

    it('same user gets different phrases for different steps', () => {
        const greet = pickPhrase('+14155550123', 'greet')
        const welcome = pickPhrase('+14155550123', 'welcome')
        expect(greet).not.toBe(welcome)
    })

    it('throws on unknown step', () => {
        expect(() => pickPhrase('+14155550123', 'not_a_step' as never)).toThrow()
    })
})
