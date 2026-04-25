import { randomUUID } from 'node:crypto'
import type { SheetsClient } from './sheets'

export interface Knowledge {
    id: string
    date: string
    venueId: string
    mealLabel: string
    item: string
    tags: string[]
    createdAt: string
}

const RANGE = 'knowledge!A:G'

function parseTags(raw: string, id: string): string[] {
    if (!raw) return []
    try {
        const v = JSON.parse(raw)
        if (Array.isArray(v) && v.every((s) => typeof s === 'string')) return v
        console.warn(`[knowledge] ${id} tags: expected string[], got ${typeof v}; defaulting to []`)
        return []
    } catch (err) {
        console.warn(`[knowledge] ${id} tags: invalid JSON (${err instanceof Error ? err.message : err}); defaulting to []`)
        return []
    }
}

function rowToKnowledge(row: string[]): Knowledge {
    const id = row[0] ?? ''
    return {
        id,
        date: row[1] ?? '',
        venueId: row[2] ?? '',
        mealLabel: row[3] ?? '',
        item: row[4] ?? '',
        tags: parseTags(row[5] ?? '', id),
        createdAt: row[6] ?? '',
    }
}

function knowledgeToRow(k: Knowledge): string[] {
    return [k.id, k.date, k.venueId, k.mealLabel, k.item, JSON.stringify(k.tags), k.createdAt]
}

export interface KnowledgeDraft {
    date: string
    venueId: string
    mealLabel: string
    item: string
    tags: string[]
}

export async function addKnowledge(client: SheetsClient, draft: KnowledgeDraft): Promise<Knowledge> {
    const k: Knowledge = {
        id: randomUUID(),
        ...draft,
        createdAt: new Date().toISOString(),
    }
    await client.append(RANGE, [knowledgeToRow(k)])
    return k
}

export async function getKnowledgeForDay(
    client: SheetsClient,
    date: string,
    venueId?: string
): Promise<Knowledge[]> {
    const rows = await client.get(RANGE)
    const out: Knowledge[] = []
    for (let i = 1; i < rows.length; i++) {
        const k = rowToKnowledge(rows[i]!)
        if (!k.id) continue
        if (k.date !== date) continue
        if (venueId && k.venueId !== venueId) continue
        out.push(k)
    }
    return out
}
