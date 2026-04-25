import { findVenue } from '../config/venues'
import { buildVenueMenu } from './buildMenu'
import { extractBamcoData } from './extractBamcoBlob'
import { fetchVenueHtml } from './fetcher'
import type { VenueMenu } from './types'

export interface GetVenueMenuOptions {
    fetchImpl?: typeof fetch
}

export async function getVenueMenu(
    venueId: string,
    date: string,
    opts: GetVenueMenuOptions = {}
): Promise<VenueMenu> {
    const venue = findVenue(venueId)
    if (!venue) throw new Error(`Unknown venue: ${venueId}`)
    const html = await fetchVenueHtml(venue.bonAppetitSlug, date, { fetchImpl: opts.fetchImpl })
    const data = extractBamcoData(html)
    if (!data) {
        return {
            venueId: venue.id,
            venueName: venue.name,
            date,
            dayparts: [],
            fetchedAt: new Date().toISOString(),
        }
    }
    return buildVenueMenu(data, {
        venueId: venue.id,
        venueName: venue.name,
        date,
    })
}
