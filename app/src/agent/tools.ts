import { addKnowledge, getKnowledgeForDay } from '../db/knowledge'
import type { SheetsClient } from '../db/sheets'
import type { User } from '../db/users'

export interface ToolContext {
    client: SheetsClient
    user: User | null
}

export interface ToolArgs {
    date?: string
    venueId?: string
    mealLabel?: string
    item?: string
    tags?: string[]
}

export async function executeTool(
    name: string,
    args: ToolArgs,
    ctx: ToolContext,
): Promise<string> {
    try {
        switch (name) {
            case 'get_knowledge': {
                const date = args.date ?? new Date().toISOString().slice(0, 10)
                const rows = await getKnowledgeForDay(ctx.client, date, args.venueId)
                if (rows.length === 0) return 'No knowledge yet for that day/venue.'
                return rows
                    .map((k) => `- ${k.venueId} ${k.mealLabel}: ${k.item} [${k.tags.join(',')}]`)
                    .join('\n')
            }
            case 'save_knowledge': {
                if (!args.venueId || !args.mealLabel || !args.item) {
                    return 'Error: venueId, mealLabel, item required'
                }
                const date = args.date ?? new Date().toISOString().slice(0, 10)
                await addKnowledge(ctx.client, {
                    date,
                    venueId: args.venueId,
                    mealLabel: args.mealLabel,
                    item: args.item,
                    tags: args.tags ?? ['neutral'],
                })
                return `Saved: ${args.item}`
            }
            default:
                return `Unknown tool: ${name}`
        }
    } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
    }
}
