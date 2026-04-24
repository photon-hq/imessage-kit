import { randomUUID } from 'node:crypto'
import type { SheetsClient } from './sheets'

export interface Schedule {
    id: string
    handle: string
    venueId: string
    dayOfWeek: number
    mealLabel: string
    startHhmm: string
    createdAt: string
}

const RANGE = 'schedules!A:G'

function rowToSchedule(row: string[]): Schedule {
    return {
        id: row[0] ?? '',
        handle: row[1] ?? '',
        venueId: row[2] ?? '',
        dayOfWeek: Number(row[3] ?? '0'),
        mealLabel: row[4] ?? '',
        startHhmm: row[5] ?? '',
        createdAt: row[6] ?? '',
    }
}

function scheduleToRow(s: Schedule): string[] {
    return [s.id, s.handle, s.venueId, String(s.dayOfWeek), s.mealLabel, s.startHhmm, s.createdAt]
}

export async function listSchedules(client: SheetsClient, handle?: string): Promise<Schedule[]> {
    const rows = await client.get(RANGE)
    const out: Schedule[] = []
    for (let i = 1; i < rows.length; i++) {
        const s = rowToSchedule(rows[i]!)
        if (handle && s.handle !== handle) continue
        if (!s.id) continue
        out.push(s)
    }
    return out
}

export interface ScheduleDraft {
    handle: string
    venueId: string
    dayOfWeek: number
    mealLabel: string
    startHhmm: string
}

export async function addSchedule(client: SheetsClient, draft: ScheduleDraft): Promise<Schedule> {
    const s: Schedule = {
        id: randomUUID(),
        ...draft,
        createdAt: new Date().toISOString(),
    }
    await client.append(RANGE, [scheduleToRow(s)])
    return s
}

export async function deleteSchedulesFor(client: SheetsClient, handle: string): Promise<void> {
    const rows = await client.get(RANGE)
    if (rows.length <= 1) return
    const header = rows[0]!
    const keep: string[][] = [header]
    for (let i = 1; i < rows.length; i++) {
        if (rows[i]?.[1] !== handle) keep.push(rows[i]!)
    }
    await client.clear(RANGE)
    await client.append(RANGE, keep)
}
