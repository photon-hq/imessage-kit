import type { VenueMenu } from '../scraper/types'

export interface UserProfile {
    dietaryRestrictions: string[]
    affinities: string[] // venue ids the user has scheduled in the past
}

export interface KnowledgePoint {
    venueId: string
    tags: string[]
}

export interface RankedVenue {
    venueId: string
    venueName: string
    score: number
    reasons: string[]
}

function hasItemMatchingAny(menu: VenueMenu, diet: string[]): boolean {
    for (const dp of menu.dayparts) {
        for (const st of dp.stations) {
            for (const item of st.items) {
                if (diet.some((d) => item.tags.includes(d))) return true
            }
        }
    }
    return false
}

function countStationsWithDietMatch(menu: VenueMenu, diet: string[]): number {
    let n = 0
    for (const dp of menu.dayparts) {
        for (const st of dp.stations) {
            if (st.items.some((it) => diet.some((d) => it.tags.includes(d)))) n++
        }
    }
    return n
}

export function rankVenues(
    menus: VenueMenu[],
    user: UserProfile,
    knowledge: KnowledgePoint[]
): RankedVenue[] {
    const ranked: RankedVenue[] = menus.map((m) => {
        const reasons: string[] = []
        let score = 10

        if (user.dietaryRestrictions.length > 0) {
            if (!hasItemMatchingAny(m, user.dietaryRestrictions)) {
                return {
                    venueId: m.venueId,
                    venueName: m.venueName,
                    score: Number.NEGATIVE_INFINITY,
                    reasons: [`no items matching ${user.dietaryRestrictions.join('/')}`],
                }
            }
            const matches = countStationsWithDietMatch(m, user.dietaryRestrictions)
            if (matches > 0) {
                score += matches * 2
                reasons.push(`${matches} station(s) fit diet`)
            }
        }

        const venueKnowledge = knowledge.filter((k) => k.venueId === m.venueId)
        const positives = venueKnowledge.filter((k) => k.tags.includes('positive')).length
        const negatives = venueKnowledge.filter((k) => k.tags.includes('negative')).length
        if (positives > 0) {
            score += positives
            reasons.push(`${positives} positive note(s) today`)
        }
        if (negatives > 0) {
            score -= negatives * 3
            reasons.push(`${negatives} negative note(s) today`)
        }

        if (user.affinities.includes(m.venueId)) {
            score += 1
            reasons.push('regular spot')
        }

        return { venueId: m.venueId, venueName: m.venueName, score, reasons }
    })

    return ranked.filter((r) => r.score > Number.NEGATIVE_INFINITY).sort((a, b) => b.score - a.score)
}
