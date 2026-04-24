import { findVenue, getDiningHalls } from '../../config/venues'
import { getKnowledgeForDay } from '../../db/knowledge'
import { listSchedules } from '../../db/schedules'
import type { SheetsClient } from '../../db/sheets'
import type { User } from '../../db/users'
import { rankVenues } from '../../lib/rank'
import type { VenueMenu } from '../../scraper/types'
import { pickPhrase } from '../prompts/phrases'

export interface Recommendation {
    venueId: string
    venueName: string
    message: string
}

export interface RecommendInput {
    client: SheetsClient
    user: User
    venueId: string
    mealLabel: string
    date: string
    fetchMenu: (venueId: string, date: string) => Promise<VenueMenu>
}

function topItem(menu: VenueMenu): { station: string; item: string } | null {
    for (const dp of menu.dayparts) {
        for (const st of dp.stations) {
            if (st.items.length > 0) return { station: st.name, item: st.items[0]!.name }
        }
    }
    return null
}

export async function buildRecommendation(input: RecommendInput): Promise<Recommendation> {
    const { client, user, venueId, mealLabel, date, fetchMenu } = input

    const knowledge = await getKnowledgeForDay(client, date)

    let chosenMenu: VenueMenu
    if (venueId !== 'auto') {
        const v = findVenue(venueId)
        if (!v) throw new Error(`Unknown venue: ${venueId}`)
        chosenMenu = await fetchMenu(v.id, date)
    } else {
        const halls = getDiningHalls()
        const menus = await Promise.all(halls.map((h) => fetchMenu(h.id, date)))
        const schedules = await listSchedules(client, user.handle)
        const affinities = [
            ...new Set(schedules.map((s) => s.venueId).filter((id) => id !== 'auto')),
        ]
        const ranked = rankVenues(
            menus,
            { dietaryRestrictions: user.dietaryRestrictions, affinities },
            knowledge.map((k) => ({ venueId: k.venueId, tags: k.tags })),
        )
        if (ranked.length === 0) throw new Error('No venues passed ranking filters')
        const top = ranked[0]!
        chosenMenu = menus.find((m) => m.venueId === top.venueId)!
    }

    const item = topItem(chosenMenu)
    const venueKnowledge = knowledge
        .filter((k) => k.venueId === chosenMenu.venueId)
        .slice(0, 1)

    const intro = pickPhrase(user.handle, 'pre_meal_intro')
    const parts: string[] = [
        `${intro} — ${mealLabel.toLowerCase()} at ${chosenMenu.venueName}`,
    ]
    if (item) parts.push(`${item.station}: ${item.item}`)
    if (venueKnowledge[0]) parts.push(`(someone said: "${venueKnowledge[0].item}")`)

    return {
        venueId: chosenMenu.venueId,
        venueName: chosenMenu.venueName,
        message: parts.join('. '),
    }
}
