export interface RawCorIcon { id: string; label: string }
export interface RawMenuItem {
    id: string
    label: string
    description?: string
    cor_icon?: Record<string, string>
    station_id?: string
}

export interface RawDaypartStation {
    id: string
    label: string
    items: string[]
    order_id?: string
}

export interface RawDaypart {
    id: string
    label: string
    starttime: string // "HH:MM" NY local
    endtime: string
    stations: RawDaypartStation[]
}

export interface BamcoData {
    menuItems: Record<string, RawMenuItem>
    dayparts: RawDaypart[]
}

function findBalancedBlob(html: string, fromIdx: number): string | null {
    const braceStart = html.indexOf('{', fromIdx)
    if (braceStart === -1) return null

    let depth = 0
    let inString: '"' | "'" | null = null
    let escape = false

    for (let i = braceStart; i < html.length; i++) {
        const c = html[i]!
        if (escape) {
            escape = false
            continue
        }
        if (inString) {
            if (c === '\\') {
                escape = true
            } else if (c === inString) {
                inString = null
            }
            continue
        }
        if (c === '"' || c === "'") {
            inString = c
            continue
        }
        if (c === '{') depth++
        else if (c === '}') {
            depth--
            if (depth === 0) return html.slice(braceStart, i + 1)
        }
    }
    return null
}

export function extractBamcoData(html: string): BamcoData | null {
    const itemsAnchor = html.indexOf('Bamco.menu_items = ')
    if (itemsAnchor === -1) return null
    const itemsBlob = findBalancedBlob(html, itemsAnchor)
    if (!itemsBlob) return null

    let menuItems: Record<string, RawMenuItem>
    try {
        menuItems = JSON.parse(itemsBlob) as Record<string, RawMenuItem>
    } catch {
        return null
    }

    const dayparts: RawDaypart[] = []
    const dpRe = /Bamco\.dayparts\['(\d+)'\]\s*=\s*/g
    let m: RegExpExecArray | null
    while ((m = dpRe.exec(html)) !== null) {
        const blob = findBalancedBlob(html, m.index + m[0].length - 1)
        if (!blob) continue
        try {
            const parsed = JSON.parse(blob) as RawDaypart
            dayparts.push(parsed)
        } catch {
            continue
        }
    }

    return { menuItems, dayparts }
}

export function extractBamcoBlob(html: string): string | null {
    const data = extractBamcoData(html)
    if (!data) return null
    return JSON.stringify(data)
}
