import { createHash, randomUUID } from 'node:crypto'
import type { SheetsClient } from './sheets'

export interface MealEvent {
    id: string
    handle: string
    scheduleId: string
    mealKey: string
    venueId: string
    date: string
    mealLabel: string
    startIso: string
    endIso: string
    preSentAt: string
    postSentAt: string
    userReply: string
}

const RANGE = 'meal_events!A:L'

export function computeMealKey(handle: string, date: string, mealLabel: string): string {
    return createHash('sha256').update(`${handle}:${date}:${mealLabel}`).digest('hex').slice(0, 16)
}

function rowToEvent(row: string[]): MealEvent {
    return {
        id: row[0] ?? '',
        handle: row[1] ?? '',
        scheduleId: row[2] ?? '',
        mealKey: row[3] ?? '',
        venueId: row[4] ?? '',
        date: row[5] ?? '',
        mealLabel: row[6] ?? '',
        startIso: row[7] ?? '',
        endIso: row[8] ?? '',
        preSentAt: row[9] ?? '',
        postSentAt: row[10] ?? '',
        userReply: row[11] ?? '',
    }
}

function eventToRow(e: MealEvent): string[] {
    return [
        e.id,
        e.handle,
        e.scheduleId,
        e.mealKey,
        e.venueId,
        e.date,
        e.mealLabel,
        e.startIso,
        e.endIso,
        e.preSentAt,
        e.postSentAt,
        e.userReply,
    ]
}

async function findRowById(
    client: SheetsClient,
    id: string,
): Promise<{ index: number; row: string[] } | null> {
    const rows = await client.get(RANGE)
    for (let i = 1; i < rows.length; i++) {
        if (rows[i]?.[0] === id) return { index: i, row: rows[i]! }
    }
    return null
}

export async function findByMealKey(client: SheetsClient, mealKey: string): Promise<MealEvent | null> {
    const rows = await client.get(RANGE)
    for (let i = 1; i < rows.length; i++) {
        if (rows[i]?.[3] === mealKey) return rowToEvent(rows[i]!)
    }
    return null
}

export interface MealEventDraft {
    handle: string
    scheduleId: string
    venueId: string
    date: string
    mealLabel: string
    startIso: string
    endIso: string
}

export async function claimMealWindow(
    client: SheetsClient,
    draft: MealEventDraft
): Promise<MealEvent | null> {
    const mealKey = computeMealKey(draft.handle, draft.date, draft.mealLabel)
    const existing = await findByMealKey(client, mealKey)
    if (existing) return null
    const event: MealEvent = {
        id: randomUUID(),
        handle: draft.handle,
        scheduleId: draft.scheduleId,
        mealKey,
        venueId: draft.venueId,
        date: draft.date,
        mealLabel: draft.mealLabel,
        startIso: draft.startIso,
        endIso: draft.endIso,
        preSentAt: '',
        postSentAt: '',
        userReply: '',
    }
    await client.append(RANGE, [eventToRow(event)])
    return event
}

async function updateEvent(client: SheetsClient, id: string, patch: Partial<MealEvent>): Promise<void> {
    const found = await findRowById(client, id)
    if (!found) throw new Error(`MealEvent not found: ${id}`)
    const next: MealEvent = { ...rowToEvent(found.row), ...patch }
    const sheetRow = found.index + 1
    await client.update(`meal_events!A${sheetRow}:L${sheetRow}`, [eventToRow(next)])
}

export async function markPreSent(client: SheetsClient, id: string): Promise<void> {
    await updateEvent(client, id, { preSentAt: new Date().toISOString() })
}

export async function markPostSent(client: SheetsClient, id: string): Promise<void> {
    await updateEvent(client, id, { postSentAt: new Date().toISOString() })
}

export async function recordUserReply(client: SheetsClient, id: string, reply: string): Promise<void> {
    await updateEvent(client, id, { userReply: reply })
}

export async function findPendingPostsBefore(
    client: SheetsClient,
    cutoffIso: string
): Promise<MealEvent[]> {
    const rows = await client.get(RANGE)
    const cutoff = new Date(cutoffIso).getTime()
    const out: MealEvent[] = []
    for (let i = 1; i < rows.length; i++) {
        const e = rowToEvent(rows[i]!)
        if (!e.id) continue
        if (e.postSentAt) continue
        const endPlus10 = new Date(e.endIso).getTime() + 10 * 60_000
        if (endPlus10 <= cutoff) out.push(e)
    }
    return out
}

export async function findRecentForHandle(
    client: SheetsClient,
    handle: string,
    minutesBack: number
): Promise<MealEvent[]> {
    const rows = await client.get(RANGE)
    const cutoff = Date.now() - minutesBack * 60_000
    const out: MealEvent[] = []
    for (let i = 1; i < rows.length; i++) {
        const e = rowToEvent(rows[i]!)
        if (!e.id || e.handle !== handle) continue
        if (new Date(e.startIso).getTime() >= cutoff) out.push(e)
    }
    return out
}
