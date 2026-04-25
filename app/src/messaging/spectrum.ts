import { Spectrum, text, type SpectrumInstance } from 'spectrum-ts'
import { imessage } from 'spectrum-ts/providers/imessage'
import type { MessageAdapter } from './types'

export interface SpectrumOptions {
    projectId: string
    projectSecret: string
}

export interface SpectrumAdapter extends MessageAdapter {
    instance: SpectrumInstance
    stop(): Promise<void>
}

export async function createSpectrumAdapter(opts: SpectrumOptions): Promise<SpectrumAdapter> {
    const spectrum = await Spectrum({
        projectId: opts.projectId,
        projectSecret: opts.projectSecret,
        providers: [imessage.config()],
    })
    const im = imessage(spectrum)

    return {
        instance: spectrum,
        async send(to, body) {
            const space = await im.space([to])
            await space.send(text(body))
        },
        async stop() {
            await spectrum.stop()
        },
    }
}
