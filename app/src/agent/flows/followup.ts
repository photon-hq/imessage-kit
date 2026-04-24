import { findVenue } from '../../config/venues'
import { addKnowledge } from '../../db/knowledge'
import { recordUserReply, type MealEvent } from '../../db/mealEvents'
import type { SheetsClient } from '../../db/sheets'
import type { User } from '../../db/users'
import { pickPhrase } from '../prompts/phrases'

export interface FollowupMessageInput {
    handle: string
    venueName: string
}

export function buildFollowupMessage(input: FollowupMessageInput): string {
    const opener = pickPhrase(input.handle, 'post_meal_checkin')
    return `${opener} (${input.venueName})`
}

export interface ExtractedTidbit {
    item: string
    tags: string[]
}

export interface IngestFollowupInput {
    client: SheetsClient
    user: User
    event: MealEvent
    reply: string
    extractTidbits: (reply: string, event: MealEvent) => Promise<ExtractedTidbit[]>
}

export async function ingestFollowupReply(input: IngestFollowupInput): Promise<void> {
    const { client, event, reply, extractTidbits } = input
    await recordUserReply(client, event.id, reply)
    const tidbits = await extractTidbits(reply, event)
    const venue = findVenue(event.venueId)
    if (!venue) return
    for (const t of tidbits) {
        await addKnowledge(client, {
            date: event.date,
            venueId: venue.id,
            mealLabel: event.mealLabel,
            item: t.item,
            tags: t.tags,
        })
    }
}
