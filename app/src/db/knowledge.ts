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

function rowToKnowledge(row: string[]): Knowledge {
    return {
        id: row[0] ?? '',
        date: row[1] ?? '',
        venueId: row[2] ?? '',
        mealLabel: row[3] ?? '',
        item: row[4] ?? '',
        tags: row[5] ? (JSON.parse(row[5]) as string[]) : [],
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
