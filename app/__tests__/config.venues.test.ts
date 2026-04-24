import { describe, expect, it } from 'bun:test'
import { VENUES, findVenue, getDiningHalls } from '../src/config/venues'

describe('venues', () => {
    it('exposes the 15 expected venues', () => {
        expect(VENUES.length).toBe(15)
    })

    it('finds a venue by exact name', () => {
        const v = findVenue('1920 Commons')
        expect(v?.id).toBe('1920-commons')
    })

    it('finds a venue by case-insensitive substring', () => {
        expect(findVenue('hill')?.id).toBe('hill-house')
        expect(findVenue('HOUSTON')?.id).toBe('houston-market')
    })

    it('returns undefined for unknown names', () => {
        expect(findVenue('fake hall')).toBeUndefined()
    })

    it('filters dining halls only', () => {
        const halls = getDiningHalls()
        expect(halls.every((v) => v.type === 'dining_hall')).toBe(true)
        expect(halls.length).toBeGreaterThanOrEqual(4)
    })

    it('every venue has a bonAppetitSlug', () => {
        for (const v of VENUES) {
            expect(v.bonAppetitSlug.length).toBeGreaterThan(0)
        }
    })
})
