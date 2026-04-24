import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const TZ = 'America/New_York'

export function nyNow(): Date {
    return new Date()
}

export function nyDateKey(d: Date): string {
    return formatInTimeZone(d, TZ, 'yyyy-MM-dd')
}

export function nyHHMM(d: Date): string {
    return formatInTimeZone(d, TZ, 'HH:mm')
}

export function nyDayOfWeek(d: Date): number {
    return Number(formatInTimeZone(d, TZ, 'i')) % 7 // i = 1..7 (Mon..Sun)
}

export function minutesUntil(target: Date, now: Date): number {
    return Math.round((target.getTime() - now.getTime()) / 60_000)
}

export function parseIsoDate(s: string): Date {
    // Treat as NY midnight, return the corresponding UTC instant
    return fromZonedTime(`${s}T00:00:00`, TZ)
}

export function combineNyDateAndTime(dateKey: string, hhmm: string): Date {
    return fromZonedTime(`${dateKey}T${hhmm}:00`, TZ)
}
