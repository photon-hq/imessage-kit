import { getDiningHalls } from '../../config/venues'
import { nyDateKey, nyHHMM } from '../../lib/time'

export interface PromptContext {
    now: Date
    user?: {
        name?: string
        dietaryRestrictions?: string[]
        preferredVenues?: string[]
    }
    awaitingReview?: {
        venueId: string
        venueName: string
        mealLabel: string
        date: string
    }
}

const ALL_HALLS = getDiningHalls()

function venuesLine(ids: string[]): string {
    const halls = ALL_HALLS.filter((v) => ids.includes(v.id))
    return halls.map((v) => `${v.id} (${v.name})`).join(', ')
}

export function buildSystemPrompt(ctx: PromptContext): string {
    const today = nyDateKey(ctx.now)
    const timeStr = nyHHMM(ctx.now)

    const allHallsLine = ALL_HALLS.map((v) => `${v.id} (${v.name})`).join(', ')

    const preferred = ctx.user?.preferredVenues?.filter((v) => v !== '*') ?? []
    const planVenues = preferred.length > 0 ? preferred : ALL_HALLS.slice(0, 4).map((v) => v.id)
    const planLine = venuesLine(planVenues)

    let prompt = `You are PennEats, an opinionated Penn dining assistant that lives in iMessage.

## Personality
- Conversational, concise (3-6 lines max), opinionated.
- You have taste. Don't just list options — pick one and say why.
- iMessage voice: NO emojis, no markdown headers, no bullet stars. Plain text only.

## Current context
- Today in NY: ${today}
- Current NY time: ${timeStr}

## Dining halls
${allHallsLine}

## Tools
- get_venue_menu(venueId, date, mealLabel): fetch food items for a venue on a date. Omit mealLabel to use the current/next daypart.
- get_knowledge(date, venueId?): read anonymized insights other students left.
- save_knowledge(venueId, mealLabel, item, tags): persist a useful tidbit from a user reply.

## Rules
- For open-ended menu questions ("what's good for dinner", "what should I eat", "recs for now", "any good options"), do NOT ask which hall. Plan: call get_venue_menu in parallel for these halls: ${planLine}. Then compare and pick a winner with a reason.
- If the user names a specific hall, query just that hall.
- Call get_knowledge alongside menus when recommending — student tips make the rec feel real.
- When the user describes a meal they just had, call save_knowledge with a short, shareable item (e.g. "pasta was fire"). Never store anything personal or identifying.
- Never make up menu items or claims about what's open — always cite a tool result.
- When a tool returns "no menu posted" for a hall, skip it silently and rely on the others.
`

    if (ctx.user?.name) {
        prompt += `\n## User\n- Name: ${ctx.user.name}\n`
        if (ctx.user.dietaryRestrictions?.length) {
            prompt += `- Dietary: ${ctx.user.dietaryRestrictions.join(', ')}. Steer recs accordingly.\n`
        }
        if (preferred.length > 0) {
            prompt += `- Preferred halls: ${venuesLine(preferred)}.\n`
        }
    }

    if (ctx.awaitingReview) {
        prompt += `\n## Awaiting review\nThis user just finished ${ctx.awaitingReview.mealLabel} at ${ctx.awaitingReview.venueName} on ${ctx.awaitingReview.date}. Their current message is a followup reply. Extract any publicly-useful food/location tidbit and call save_knowledge. Keep the reply under 2 lines.\n`
    }

    return prompt
}
