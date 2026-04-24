import { findVenue } from '../config/venues'
import {
    claimMealWindow,
    findPendingPostsBefore,
    markPostSent,
    markPreSent,
} from '../db/mealEvents'
import { listSchedules } from '../db/schedules'
import type { SheetsClient } from '../db/sheets'
import { getUser } from '../db/users'
import { buildFollowupMessage } from '../agent/flows/followup'
import { buildRecommendation } from '../agent/flows/recommend'
import { combineNyDateAndTime, minutesUntil, nyDateKey, nyDayOfWeek } from '../lib/time'
import type { MessageAdapter } from '../messaging/types'
import type { VenueMenu } from '../scraper/types'

export interface TickDeps {
    client: SheetsClient
    adapter: MessageAdapter
    now: Date
    fetchMenu: (venueId: string, date: string) => Promise<VenueMenu>
}

const MEAL_DURATION_MIN = 90
const PRE_WINDOW_MIN_LOW = 18
const PRE_WINDOW_MIN_HIGH = 22

export async function runTick(deps: TickDeps): Promise<void> {
    await runPreMealPass(deps)
    await runPostMealPass(deps)
}

async function runPreMealPass(deps: TickDeps): Promise<void> {
    const { client, adapter, now, fetchMenu } = deps
    const today = nyDateKey(now)
    const dow = nyDayOfWeek(now)
    const schedules = await listSchedules(client)

    for (const s of schedules) {
        try {
            if (s.dayOfWeek !== dow) continue
            const startDate = combineNyDateAndTime(today, s.startHhmm)
            const delta = minutesUntil(startDate, now)
            if (delta < PRE_WINDOW_MIN_LOW || delta > PRE_WINDOW_MIN_HIGH) continue

            const user = await getUser(client, s.handle)
            if (!user || user.state !== 'active') continue

            const endIso = new Date(startDate.getTime() + MEAL_DURATION_MIN * 60_000).toISOString()
            const event = await claimMealWindow(client, {
                handle: s.handle,
                scheduleId: s.id,
                venueId: s.venueId,
                date: today,
                mealLabel: s.mealLabel,
                startIso: startDate.toISOString(),
                endIso,
            })
            if (!event) continue

            const rec = await buildRecommendation({
                client,
                user,
                venueId: s.venueId,
                mealLabel: s.mealLabel,
                date: today,
                fetchMenu,
            })

            await adapter.send(s.handle, rec.message)
            await markPreSent(client, event.id)
        } catch (err) {
            console.error(`[tick] pre-meal failure for ${s.handle}:`, err instanceof Error ? err.message : err)
        }
    }
}

async function runPostMealPass(deps: TickDeps): Promise<void> {
    const { client, adapter, now } = deps
    const pending = await findPendingPostsBefore(client, now.toISOString())

    for (const event of pending) {
        try {
            const venue = findVenue(event.venueId)
            if (!venue) {
                await markPostSent(client, event.id)
                continue
            }
            const text = buildFollowupMessage({ handle: event.handle, venueName: venue.name })
            await adapter.send(event.handle, text)
            await markPostSent(client, event.id)
        } catch (err) {
            console.error(`[tick] post-meal failure for ${event.handle}:`, err instanceof Error ? err.message : err)
        }
    }
}
