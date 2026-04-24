import { describe, expect, it } from 'bun:test'
import {
    combineNyDateAndTime,
    minutesUntil,
    nyDateKey,
    nyDayOfWeek,
    nyHHMM,
    parseIsoDate,
} from '../src/lib/time'

describe('time helpers', () => {
    it('formats NY date key from a UTC Date', () => {
        // 2026-04-24 05:00 UTC = 2026-04-24 01:00 EDT
        const d = new Date('2026-04-24T05:00:00Z')
        expect(nyDateKey(d)).toBe('2026-04-24')
    })

    it('rolls back to prior day before NY midnight', () => {
        // 2026-04-24 03:00 UTC = 2026-04-23 23:00 EDT
        const d = new Date('2026-04-24T03:00:00Z')
        expect(nyDateKey(d)).toBe('2026-04-23')
    })

    it('formats NY HH:MM', () => {
        const d = new Date('2026-04-24T16:30:00Z') // 12:30 EDT
        expect(nyHHMM(d)).toBe('12:30')
    })

    it('returns NY day-of-week', () => {
        const friday = new Date('2026-04-24T16:00:00Z') // Fri 12:00 EDT
        expect(nyDayOfWeek(friday)).toBe(5)
    })

    it('computes signed minutes between two dates', () => {
        const a = new Date('2026-04-24T12:00:00Z')
        const b = new Date('2026-04-24T12:30:00Z')
        expect(minutesUntil(b, a)).toBe(30)
        expect(minutesUntil(a, b)).toBe(-30)
    })

    it('parses YYYY-MM-DD to NY midnight', () => {
        const d = parseIsoDate('2026-04-24')
        expect(nyDateKey(d)).toBe('2026-04-24')
        expect(nyHHMM(d)).toBe('00:00')
    })

    it('combines NY date and HH:MM into a UTC Date', () => {
        // 2026-04-24 12:30 EDT = 2026-04-24 16:30 UTC
        const d = combineNyDateAndTime('2026-04-24', '12:30')
        expect(d.toISOString()).toBe('2026-04-24T16:30:00.000Z')
    })
})
