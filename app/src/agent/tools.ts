import { findVenue } from '../config/venues'
import { addKnowledge, getKnowledgeForDay } from '../db/knowledge'
import type { SheetsClient } from '../db/sheets'
import type { User } from '../db/users'
import { pickDaypart } from '../lib/pickDaypart'
import type { VenueMenu } from '../scraper/types'

export interface ToolContext {
    client: SheetsClient
    user: User | null
    fetchMenu?: (venueId: string, date: string) => Promise<VenueMenu>
}

export interface ToolArgs {
    date?: string
    venueId?: string
    mealLabel?: string
    item?: string
    tags?: string[]
}

function summarizeMenu(menu: VenueMenu, mealLabel?: string): string {
    if (menu.dayparts.length === 0) {
        return `${menu.venueName} on ${menu.date}: no menu posted.`
    }
    const dp =
        (mealLabel && menu.dayparts.find((d) => d.label.toLowerCase() === mealLabel.toLowerCase())) ||
        pickDaypart(menu, new Date()) ||
        menu.dayparts[0]!
    const lines: string[] = [`${menu.venueName} — ${dp.label}:`]
    for (const station of dp.stations.slice(0, 4)) {
        const items = station.items.slice(0, 4).map((it) => it.name).join(', ')
        if (items) lines.push(`- ${station.name}: ${items}`)
    }
    return lines.join('\n')
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
            case 'get_venue_menu': {
                if (!ctx.fetchMenu) return 'Error: menu fetch not available'
                if (!args.venueId) return 'Error: venueId required'
                const v = findVenue(args.venueId)
                if (!v) return `Error: unknown venue "${args.venueId}"`
                const date = args.date ?? new Date().toISOString().slice(0, 10)
                const menu = await ctx.fetchMenu(v.id, date)
                return summarizeMenu(menu, args.mealLabel)
            }
            default:
                return `Unknown tool: ${name}`
        }
    } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
    }
}
