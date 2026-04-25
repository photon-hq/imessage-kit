import { randomUUID } from 'node:crypto'
import type { SheetsClient } from './sheets'

export type MessageRole = 'user' | 'model'

export interface Message {
    id: string
    handle: string
    ts: string
    role: MessageRole
    content: string
}

const RANGE = 'messages!A:E'

function rowToMessage(row: string[]): Message {
    return {
        id: row[0] ?? '',
        handle: row[1] ?? '',
        ts: row[2] ?? '',
        role: (row[3] as MessageRole) ?? 'user',
        content: row[4] ?? '',
    }
}

function messageToRow(m: Message): string[] {
    return [m.id, m.handle, m.ts, m.role, m.content]
}

export interface MessageDraft {
    handle: string
    role: MessageRole
    content: string
}

export async function appendMessage(
    client: SheetsClient,
    draft: MessageDraft,
): Promise<Message> {
    const m: Message = {
        id: randomUUID(),
        ...draft,
        ts: new Date().toISOString(),
    }
    await client.append(RANGE, [messageToRow(m)])
    return m
}

export async function recentMessagesForHandle(
    client: SheetsClient,
    handle: string,
    limit: number,
): Promise<Message[]> {
    const rows = await client.get(RANGE)
    const matches: Message[] = []
    for (let i = 1; i < rows.length; i++) {
        const m = rowToMessage(rows[i]!)
        if (!m.id) continue
        if (m.handle !== handle) continue
        matches.push(m)
    }
    matches.sort((a, b) => a.ts.localeCompare(b.ts))
    return matches.slice(-limit)
}
