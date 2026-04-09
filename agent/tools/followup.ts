/**
 * Follow-up scheduling tools.
 *
 * When a user says they're going to a dining hall, the agent schedules
 * a follow-up message ~15 minutes after the meal period ends, asking for
 * a review. Pending follow-ups are tracked in Google Sheets so they survive
 * bot restarts.
 */

import { randomBytes } from 'node:crypto'
import { FOLLOWUP_DELAY_MS } from '../config.js'
import { type PendingFollowup, getSheetsClient, hashPhone } from '../db/sheets.js'
import type { MessageScheduler } from '@photon-ai/imessage-kit'

// ---------------------------------------------------------------------------
// Schedule a follow-up
// ---------------------------------------------------------------------------

export interface ScheduleFollowupInput {
    phone: string
    venue: string
    mealPeriod: string
    /** ISO string for when the meal period ends, e.g. "2026-04-09T21:30:00" */
    mealEndIso: string
    scheduler: MessageScheduler
}

/**
 * Schedule a follow-up iMessage and write the tracking row to Google Sheets.
 * Returns the follow-up ID.
 */
export async function scheduleFollowup(input: ScheduleFollowupInput): Promise<string> {
    const { phone, venue, mealPeriod, mealEndIso, scheduler } = input
    const phoneHash = hashPhone(phone)

    const mealEnd = new Date(mealEndIso)
    const sendAt = new Date(mealEnd.getTime() + FOLLOWUP_DELAY_MS)

    // Don't schedule in the past
    if (sendAt <= new Date()) {
        throw new Error('Meal period has already ended — cannot schedule follow-up')
    }

    const id = randomBytes(8).toString('hex')
    const message =
        `Hey! How was ${venue} ${mealPeriod.toLowerCase()}? ` +
        `Rate it 1–5 and tell me what you had — I'll share it with other Quakers! 🍽️`

    // Schedule via SDK MessageScheduler
    scheduler.schedule({ id, to: phone, content: message, sendAt })

    // Track in Sheets
    const client = getSheetsClient()
    const followup: PendingFollowup = {
        id,
        phoneHash,
        venue,
        mealPeriod,
        date: mealEndIso.slice(0, 10),
        scheduledFor: sendAt.toISOString(),
        status: 'pending',
    }
    await client.appendFollowup(followup)

    return id
}

// ---------------------------------------------------------------------------
// Check pending follow-up for a user
// ---------------------------------------------------------------------------

/**
 * Check if a user has an unanswered follow-up.
 * Returns the follow-up context (venue, meal) if found, null otherwise.
 */
export async function checkPendingFollowup(
    phone: string
): Promise<{ venue: string; mealPeriod: string; date: string } | null> {
    const client = getSheetsClient()
    const phoneHash = hashPhone(phone)
    const followup = await client.getPendingFollowupForPhone(phoneHash)
    if (!followup) return null
    return { venue: followup.venue, mealPeriod: followup.mealPeriod, date: followup.date }
}

// ---------------------------------------------------------------------------
// Mark follow-up as sent (called when the scheduler fires)
// ---------------------------------------------------------------------------

export async function markFollowupSent(id: string): Promise<void> {
    const client = getSheetsClient()
    await client.updateFollowupStatus(id, 'sent')
}

// ---------------------------------------------------------------------------
// Re-register pending follow-ups on bot restart
// ---------------------------------------------------------------------------

/**
 * On startup, load all pending follow-ups from Sheets and re-register them
 * with the scheduler (in case the bot restarted before they fired).
 */
export async function restoreFollowups(
    scheduler: MessageScheduler,
    phoneMap: Map<string, string>
): Promise<void> {
    const client = getSheetsClient()
    const pending = await client.getPendingFollowups('pending')

    for (const f of pending) {
        const sendAt = new Date(f.scheduledFor)
        if (sendAt <= new Date()) {
            // Already past — mark as sent and skip (user missed it)
            await client.updateFollowupStatus(f.id, 'sent')
            continue
        }

        const phone = phoneMap.get(f.phoneHash)
        if (!phone) continue

        const message =
            `Hey! How was ${f.venue} ${f.mealPeriod.toLowerCase()}? ` +
            `Rate it 1–5 and tell me what you had — I'll share it with other Quakers! 🍽️`

        try {
            scheduler.schedule({ id: f.id, to: phone, content: message, sendAt })
        } catch {
            // ID collision — already registered
        }
    }
}
