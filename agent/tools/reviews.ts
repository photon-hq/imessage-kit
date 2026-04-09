/**
 * Community review tools — read and write to Google Sheets.
 */

import { MAX_REVIEWS_PER_VENUE } from '../config.js'
import { type Review, getSheetsClient, hashPhone } from '../db/sheets.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewSummary {
    venue: string
    mealPeriod: string
    averageRating: number
    reviewCount: number
    recentComments: string[]
    recentFoodHighlights: string[]
    lastReviewedAt: string | null
}

// ---------------------------------------------------------------------------
// Tool: get_reviews
// ---------------------------------------------------------------------------

/**
 * Get reviews for a venue (optionally filtered by meal period).
 * Returns a ReviewSummary with avg rating, recent comments, and food highlights.
 */
export async function getReviews(
    venue?: string,
    mealPeriod?: string,
    limit = MAX_REVIEWS_PER_VENUE
): Promise<ReviewSummary[]> {
    const client = getSheetsClient()
    const reviews = await client.getReviews(venue, mealPeriod, limit * 4)

    // Group by venue + meal period
    const grouped = new Map<string, Review[]>()
    for (const r of reviews) {
        const key = `${r.venue}||${r.mealPeriod}`
        const group = grouped.get(key) ?? []
        group.push(r)
        grouped.set(key, group)
    }

    const summaries: ReviewSummary[] = []
    for (const [key, group] of grouped) {
        const [venueName, meal] = key.split('||')
        const sorted = group.sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
        const recent = sorted.slice(0, limit)
        const totalRating = group.reduce((sum, r) => sum + r.rating, 0)

        summaries.push({
            venue: venueName ?? '',
            mealPeriod: meal ?? '',
            averageRating: Math.round((totalRating / group.length) * 10) / 10,
            reviewCount: group.length,
            recentComments: recent.map((r) => r.comment).filter(Boolean),
            recentFoodHighlights: recent
                .flatMap((r) => r.foodHighlights)
                .filter(Boolean)
                .slice(0, 8),
            lastReviewedAt: sorted[0]?.timestamp ?? null,
        })
    }

    return summaries
}

// ---------------------------------------------------------------------------
// Tool: save_review
// ---------------------------------------------------------------------------

export interface SaveReviewInput {
    phone: string
    venue: string
    mealPeriod: string
    date: string
    rating: number
    comment: string
    foodHighlights?: string[]
}

/**
 * Save a community review to Google Sheets.
 * Also marks any pending follow-up for this user as responded.
 */
export async function saveReview(input: SaveReviewInput): Promise<void> {
    const client = getSheetsClient()
    const phoneHash = hashPhone(input.phone)

    // Validate rating
    const rating = Math.max(1, Math.min(5, Math.round(input.rating)))

    await client.appendReview({
        phoneHash,
        venue: input.venue,
        date: input.date,
        mealPeriod: input.mealPeriod,
        rating,
        comment: input.comment.trim(),
        foodHighlights: input.foodHighlights ?? [],
    })

    // Mark any sent follow-up as responded
    const followup = await client.getPendingFollowupForPhone(phoneHash)
    if (followup) {
        await client.updateFollowupStatus(followup.id, 'responded')
    }

    // Reset conversation state
    await client.setState(phoneHash, 'idle')
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a ReviewSummary into a concise string for LLM context.
 */
export function formatReviewSummary(summary: ReviewSummary): string {
    const stars = '★'.repeat(Math.round(summary.averageRating)) + '☆'.repeat(5 - Math.round(summary.averageRating))
    const lines: string[] = [
        `${summary.venue} ${summary.mealPeriod}: ${stars} ${summary.averageRating}/5 (${summary.reviewCount} review${summary.reviewCount !== 1 ? 's' : ''})`,
    ]
    if (summary.recentFoodHighlights.length) {
        lines.push(`  Mentioned: ${summary.recentFoodHighlights.slice(0, 5).join(', ')}`)
    }
    for (const comment of summary.recentComments.slice(0, 2)) {
        lines.push(`  "${comment}"`)
    }
    return lines.join('\n')
}
