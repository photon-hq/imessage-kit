import { GoogleGenAI, type Part } from '@google/genai'
import { TOOL_DECLARATIONS } from './tools'
import type {
    AgentFunctionCall,
    AgentGeminiClient,
    AgentStepContext,
} from './runAgent'

export function createGeminiAgentClient(apiKey: string, model = 'gemini-2.5-flash'): AgentGeminiClient {
    const ai = new GoogleGenAI({ apiKey })
    return {
        async step(ctx: AgentStepContext) {
            const contents = ctx.history.map((turn) => {
                if (turn.role === 'tool') {
                    return {
                        role: 'user',
                        parts: [
                            {
                                functionResponse: {
                                    name: turn.toolName ?? 'tool',
                                    response: { result: turn.content },
                                },
                            } as Part,
                        ],
                    }
                }
                if (turn.role === 'model') {
                    const parts: Part[] = []
                    if (turn.content) parts.push({ text: turn.content } as Part)
                    for (const fc of turn.functionCalls ?? []) {
                        parts.push({ functionCall: { name: fc.name, args: fc.args } } as Part)
                    }
                    if (parts.length === 0) parts.push({ text: '' } as Part)
                    return { role: 'model', parts }
                }
                return { role: 'user', parts: [{ text: turn.content } as Part] }
            })

            const response = await ai.models.generateContent({
                model,
                contents,
                config: {
                    systemInstruction: ctx.systemPrompt,
                    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
                    maxOutputTokens: 1024,
                },
            })
            const parts: Part[] = response.candidates?.[0]?.content?.parts ?? []
            const calls: AgentFunctionCall[] = []
            let textOut = ''
            for (const p of parts) {
                if (p.functionCall) {
                    calls.push({
                        name: p.functionCall.name ?? '',
                        args: (p.functionCall.args ?? {}) as AgentFunctionCall['args'],
                    })
                } else if (p.text) {
                    textOut += p.text
                }
            }
            return { text: textOut, functionCalls: calls }
        },
    }
}
