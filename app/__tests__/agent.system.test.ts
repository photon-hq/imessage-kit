import { describe, expect, it } from 'bun:test'
import { buildSystemPrompt } from '../src/agent/prompts/system'

describe('buildSystemPrompt', () => {
    it('includes today and current time', () => {
        const now = new Date('2026-04-24T17:30:00Z') // 13:30 EDT
        const prompt = buildSystemPrompt({ now })
        expect(prompt).toMatch(/2026-04-24|April 24/)
        expect(prompt).toMatch(/1:30|13:30/)
    })

    it('mentions tool names', () => {
        const prompt = buildSystemPrompt({ now: new Date('2026-04-24T17:30:00Z') })
        expect(prompt).toContain('get_venue_menu')
        expect(prompt).toContain('get_knowledge')
        expect(prompt).toContain('save_knowledge')
    })

    it('injects user profile when provided', () => {
        const prompt = buildSystemPrompt({
            now: new Date('2026-04-24T17:30:00Z'),
            user: {
                name: 'Alice',
                dietaryRestrictions: ['vegan'],
            },
        })
        expect(prompt).toContain('Alice')
        expect(prompt).toContain('vegan')
    })

    it('injects awaiting_review context', () => {
        const prompt = buildSystemPrompt({
            now: new Date('2026-04-24T17:30:00Z'),
            awaitingReview: {
                venueId: 'hill-house',
                venueName: 'Hill House',
                mealLabel: 'Dinner',
                date: '2026-04-23',
            },
        })
        expect(prompt).toMatch(/awaiting.review|followup/i)
        expect(prompt).toContain('Hill House')
    })
})
