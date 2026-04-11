import { describe, expect, it } from 'bun:test'
import { parseAtExpression, parseDuration } from '../src/application/reminder-time'

describe('parseDuration', () => {
    it('parses valid durations', () => {
        expect(parseDuration('5 seconds')).toBe(5_000)
        expect(parseDuration('1 minute')).toBe(60_000)
        expect(parseDuration('10 minutes')).toBe(600_000)
        expect(parseDuration('2 hours')).toBe(7_200_000)
        expect(parseDuration('1 day')).toBe(86_400_000)
        expect(parseDuration('3 weeks')).toBe(1_814_400_000)
    })

    it('is case-insensitive', () => {
        expect(parseDuration('5 Minutes')).toBe(300_000)
        expect(parseDuration('2 HOURS')).toBe(7_200_000)
    })

    it('throws on invalid format', () => {
        expect(() => parseDuration('')).toThrow()
        expect(() => parseDuration('5')).toThrow()
        expect(() => parseDuration('minutes')).toThrow()
        expect(() => parseDuration('five minutes')).toThrow()
        expect(() => parseDuration('5 years')).toThrow()
    })
})

describe('parseAtExpression', () => {
    const fixedNow = new Date('2025-06-15T14:00:00')

    it('parses time-only (future today)', () => {
        const result = parseAtExpression('5pm', fixedNow)
        expect(result.getHours()).toBe(17)
        expect(result.getMinutes()).toBe(0)
        expect(result.getDate()).toBe(15)
    })

    it('rolls to tomorrow when time is past', () => {
        const result = parseAtExpression('9am', fixedNow)
        expect(result.getHours()).toBe(9)
        expect(result.getDate()).toBe(16)
    })

    it('parses 24-hour format', () => {
        const result = parseAtExpression('17:30', fixedNow)
        expect(result.getHours()).toBe(17)
        expect(result.getMinutes()).toBe(30)
    })

    it('parses tomorrow prefix', () => {
        const result = parseAtExpression('tomorrow 9am', fixedNow)
        expect(result.getDate()).toBe(16)
        expect(result.getHours()).toBe(9)
    })

    it('parses weekday prefix', () => {
        // June 15, 2025 is a Sunday (day 0). Wednesday is day 3 → +3 days = June 18
        const result = parseAtExpression('wednesday 10:00', fixedNow)
        expect(result.getDate()).toBe(18)
        expect(result.getHours()).toBe(10)
    })

    it('advances weekday by 7 if same day and past', () => {
        // June 15 is Sunday. "sunday 9am" should be next Sunday since 9am < 14:00
        const result = parseAtExpression('sunday 9am', fixedNow)
        expect(result.getDate()).toBe(22)
    })

    it('throws on invalid time', () => {
        expect(() => parseAtExpression('', fixedNow)).toThrow()
        expect(() => parseAtExpression('13pm', fixedNow)).toThrow()
        expect(() => parseAtExpression('25:00', fixedNow)).toThrow()
    })
})
