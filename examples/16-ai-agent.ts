import { IMessageSDK } from '../src'

const sdk = new IMessageSDK({ debug: true })
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434/api/generate'
const LLM_MODEL = process.env.LLM_MODEL ?? 'qwen2:0.5b'
const LONG_MESSAGE_THRESHOLD = 200
const LOOP_WINDOW_MS = 60_000
const recentReplies = new Map<string, number>()

function rememberReply(text: string) {
    recentReplies.set(text.trim(), Date.now())
}

function isRecentAgentReply(text: string) {
    const now = Date.now()
    for (const [reply, timestamp] of recentReplies) {
        if (now - timestamp > LOOP_WINDOW_MS) recentReplies.delete(reply)
    }
    return recentReplies.has(text.trim())
}

function isSpamMessage(text: string) {
    const normalized = text.toLowerCase()
    const spamSignals = [
        /free money|earn cash|guaranteed income|claim now|limited time/i,
        /click here|tap here|bit\.ly|tinyurl|wa\.me|t\.me/i,
        /crypto giveaway|gift card|loan approval|winner|congratulations/i,
        /urgent action required|account suspended|verify your account/i,
    ]
    const letters = text.replace(/[^A-Za-z]/g, '')
    const capsRatio = text.replace(/[^A-Z]/g, '').length / Math.max(letters.length, 1)
    return spamSignals.some((pattern) => pattern.test(normalized)) || capsRatio > 0.6
}

// Ask the local Qwen model to summarize long messages like a real person texting back.
async function generateReply(text: string): Promise<string> {
    const prompt = [
        'You are a friendly iMessage assistant.',
        'Reply like a normal person texting a friend.',
        'Do not say you are an AI, assistant, bot, or language model.',
        'Do not explain your reasoning.',
        'The message is long, so acknowledge it and reply with a concise summary-style response.',
        'Keep the reply natural, useful, and under 2 sentences.',
        `Message: """${text}"""`,
    ]
        .filter(Boolean)
        .join('\n')

    const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: LLM_MODEL, prompt, stream: false }),
    })
    if (!response.ok) throw new Error(`LLM request failed: ${response.status}`)

    const data = (await response.json()) as { response?: string }
    return data.response?.trim() || 'I saw your message and I am thinking about the best response.'
}

// Watch direct messages, reason over the text, and send a reply back.
await sdk.startWatching({
    onDirectMessage: async (msg) => {
        if (msg.isFromMe || !msg.text?.trim() || isRecentAgentReply(msg.text)) return

        console.log(`[incoming] ${msg.sender}: ${msg.text}`)
        if (isSpamMessage(msg.text)) {
            console.log('[spam] Ignoring suspected spam message')
            return
        }

        if (msg.text.length <= LONG_MESSAGE_THRESHOLD) {
            console.log('[skip] Message is not long enough to summarize')
            return
        }

        try {
            const reply = await generateReply(msg.text)
            console.log(`[reply] ${reply}`)
            rememberReply(reply)
            await sdk.send(msg.sender, reply)
        } catch (error) {
            console.error('[agent-error]', error)
            const fallback = 'Sorry, that was a long one and I hit a small issue summarizing it. Can you resend it?'
            rememberReply(fallback)
            await sdk.send(msg.sender, fallback)
        }
    },
    onError: (error) => {
        console.error('[watcher-error]', error)
    },
})

console.log(`AI agent is running with model "${LLM_MODEL}"`)

// Close the watcher and SDK cleanly when you stop the script.
process.on('SIGINT', async () => {
    await sdk.stopWatching()
    await sdk.close()
    process.exit(0)
})
