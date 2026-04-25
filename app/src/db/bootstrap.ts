import type { SheetsClient } from './sheets'

export const TAB_HEADERS = {
    users: [
        'handle',
        'name',
        'email',
        'dietary_restrictions',
        'state',
        'state_context',
        'onboarding_step',
        'created_at',
        'updated_at',
    ],
    schedules: ['id', 'handle', 'venue_id', 'day_of_week', 'meal_label', 'start_hhmm', 'created_at'],
    meal_events: [
        'id',
        'handle',
        'schedule_id',
        'meal_key',
        'venue_id',
        'date',
        'meal_label',
        'start_iso',
        'end_iso',
        'pre_sent_at',
        'post_sent_at',
        'user_reply',
    ],
    knowledge: ['id', 'date', 'venue_id', 'meal_label', 'item', 'tags', 'created_at'],
} as const

export async function bootstrap(client: SheetsClient): Promise<void> {
    for (const [tab, headers] of Object.entries(TAB_HEADERS)) {
        await client.ensureTab(tab)
        const rows = await client.get(`${tab}!A:Z`)
        if (rows.length === 0) {
            await client.append(`${tab}!A:Z`, [headers as string[]])
            continue
        }
        const existing = rows[0]!
        for (let i = 0; i < headers.length; i++) {
            if (existing[i] !== headers[i]) {
                throw new Error(
                    `Tab "${tab}" header drift at column ${i}: expected "${headers[i]}", got "${existing[i] ?? '<empty>'}". Fix the spreadsheet manually.`
                )
            }
        }
    }
}
