const BASE = 'https://university-of-pennsylvania.cafebonappetit.com/cafe'
const UA = 'PennEats/2.0 (+https://github.com/photon-hq/imessage-kit)'

export interface FetchOptions {
    fetchImpl?: typeof fetch
}

function buildVenueUrl(slug: string, date: string): string {
    return `${BASE}/${slug}/?date=${date}`
}

export async function fetchVenueHtml(slug: string, date: string, opts: FetchOptions = {}): Promise<string> {
    const fetchImpl = opts.fetchImpl ?? fetch
    const url = buildVenueUrl(slug, date)
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) {
        throw new Error(`Bon Appétit fetch failed: ${res.status} ${res.statusText} for ${url}`)
    }
    return await res.text()
}
