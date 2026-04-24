import { findVenue } from '../config/venues'
import { extractBamcoBlob } from './extractBamcoBlob'
import { extractMenu, type GeminiClient } from './extractMenu'
import { fetchVenueHtml } from './fetcher'
import type { VenueMenu } from './types'

export type { GeminiClient } from './extractMenu'
export { createGeminiClient } from './extractMenu'
export type { Daypart, FoodItem, Station, VenueMenu } from './types'

export interface GetVenueMenuOptions {
    client: GeminiClient
    fetchImpl?: typeof fetch
}

export async function getVenueMenu(
    venueId: string,
    date: string,
    opts: GetVenueMenuOptions
): Promise<VenueMenu> {
    const venue = findVenue(venueId)
    if (!venue) throw new Error(`Unknown venue: ${venueId}`)
    const html = await fetchVenueHtml(venue.bonAppetitSlug, date, { fetchImpl: opts.fetchImpl })
    const blob = extractBamcoBlob(html)
    if (!blob) {
        return {
            venueId: venue.id,
            venueName: venue.name,
            date,
            dayparts: [],
            fetchedAt: new Date().toISOString(),
        }
    }
    return await extractMenu(blob, {
        venueId: venue.id,
        venueName: venue.name,
        date,
        client: opts.client,
    })
}
