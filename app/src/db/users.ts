import type { SheetsClient } from './sheets'

export type UserState = 'new' | 'onboarding' | 'active'

export interface User {
    handle: string
    name: string
    email: string
    dietaryRestrictions: string[]
    state: UserState
    stateContext: Record<string, unknown>
    onboardingStep: string
    createdAt: string
    updatedAt: string
}

const RANGE = 'users!A:I'

function rowToUser(row: string[]): User {
    return {
        handle: row[0] ?? '',
        name: row[1] ?? '',
        email: row[2] ?? '',
        dietaryRestrictions: row[3] ? (JSON.parse(row[3]) as string[]) : [],
        state: (row[4] as UserState) || 'new',
        stateContext: row[5] ? (JSON.parse(row[5]) as Record<string, unknown>) : {},
        onboardingStep: row[6] ?? '',
        createdAt: row[7] ?? '',
        updatedAt: row[8] ?? '',
    }
}

function userToRow(u: User): string[] {
    return [
        u.handle,
        u.name,
        u.email,
        JSON.stringify(u.dietaryRestrictions),
        u.state,
        JSON.stringify(u.stateContext),
        u.onboardingStep,
        u.createdAt,
        u.updatedAt,
    ]
}

export async function getUser(client: SheetsClient, handle: string): Promise<User | null> {
    const rows = await client.get(RANGE)
    for (let i = 1; i < rows.length; i++) {
        if (rows[i]?.[0] === handle) return rowToUser(rows[i]!)
    }
    return null
}

export interface UserDraft {
    handle: string
    name?: string
    email?: string
}

export async function createUser(client: SheetsClient, draft: UserDraft): Promise<User> {
    const now = new Date().toISOString()
    const user: User = {
        handle: draft.handle,
        name: draft.name ?? '',
        email: draft.email ?? '',
        dietaryRestrictions: [],
        state: 'new',
        stateContext: {},
        onboardingStep: 'ask_name',
        createdAt: now,
        updatedAt: now,
    }
    await client.append(RANGE, [userToRow(user)])
    return user
}

export type UserPatch = Partial<Omit<User, 'handle' | 'createdAt' | 'updatedAt'>>

export async function updateUser(client: SheetsClient, handle: string, patch: UserPatch): Promise<User> {
    const rows = await client.get(RANGE)
    for (let i = 1; i < rows.length; i++) {
        if (rows[i]?.[0] !== handle) continue
        const existing = rowToUser(rows[i]!)
        const next: User = {
            ...existing,
            ...patch,
            updatedAt: new Date().toISOString(),
        }
        const sheetRow = i + 1
        await client.update(`users!A${sheetRow}:I${sheetRow}`, [userToRow(next)])
        return next
    }
    throw new Error(`User not found: ${handle}`)
}
