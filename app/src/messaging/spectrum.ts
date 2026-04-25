import type { SpectrumInstance } from 'spectrum-ts'
import type { MessageAdapter } from './types'

export interface SpectrumOptions {
    projectId: string
    projectSecret: string
}

export interface SpectrumAdapter extends MessageAdapter {
    instance: SpectrumInstance
    stop(): Promise<void>
}

// Dynamic imports defer loading spectrum-ts and its photon/gRPC dependencies
// until this function is called, keeping initial module startup fast.
export async function createSpectrumAdapter(opts: SpectrumOptions): Promise<SpectrumAdapter> {
    const { Spectrum, text } = await import('spectrum-ts')
    const { imessage } = await import('spectrum-ts/providers/imessage')

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
