import { findVenue } from '../config/venues'
import { findRecentForHandle } from '../db/mealEvents'
import { appendMessage, recentMessagesForHandle } from '../db/messages'
import type { SheetsClient } from '../db/sheets'
import { createUser, getUser } from '../db/users'
import { normalizeHandle } from '../lib/handle'
import { extractTidbits, type TidbitGeminiClient } from './extractTidbits'
import { ingestFollowupReply } from './flows/followup'
import { handleOnboardingStep } from './flows/onboarding'
import { runAgent, type AgentGeminiClient, type FetchMenu, type HistoryTurn } from './runAgent'

const HISTORY_TURNS = 16

export interface RouteInput {
    client: SheetsClient
    rawHandle: string
    text: string
    geminiClient: AgentGeminiClient
    tidbitClient: TidbitGeminiClient
    fetchMenu?: FetchMenu
}

export async function routeInbound(input: RouteInput): Promise<string> {
    const { client, rawHandle, text, geminiClient, tidbitClient, fetchMenu } = input
    const handle = normalizeHandle(rawHandle)

    let user = await getUser(client, handle)
    if (!user) {
        user = await createUser(client, { handle })
    }

    if (user.state !== 'active') {
        const { reply } = await handleOnboardingStep({ client }, user, text)
        return reply
    }

    const recent = await findRecentForHandle(client, handle, 180)
    const awaitingReply = recent.find((e) => e.postSentAt && !e.userReply)
    if (awaitingReply) {
        await ingestFollowupReply({
            client,
            user,
            event: awaitingReply,
            reply: text,
            extractTidbits: (r, ev) => extractTidbits(r, ev, tidbitClient),
        })
        const venue = findVenue(awaitingReply.venueId)
        return `Thanks — noted for ${venue?.name ?? awaitingReply.venueId} 🙌`
    }

    const prior = await recentMessagesForHandle(client, handle, HISTORY_TURNS)
    const priorHistory: HistoryTurn[] = prior.map((m) => ({ role: m.role, content: m.content }))

    const reply = await runAgent({ client, user, text, geminiClient, fetchMenu, priorHistory })

    await appendMessage(client, { handle, role: 'user', content: text })
    await appendMessage(client, { handle, role: 'model', content: reply })

    return reply
}
