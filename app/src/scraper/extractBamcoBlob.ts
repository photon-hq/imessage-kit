export function extractBamcoBlob(html: string): string | null {
    // Try to find either "window.Bamco = " or "Bamco.menu_items = " anchor
    let anchorIdx = html.indexOf('window.Bamco = ')
    if (anchorIdx === -1) {
        anchorIdx = html.indexOf('Bamco.menu_items = ')
    }
    if (anchorIdx === -1) return null
    const braceStart = html.indexOf('{', anchorIdx)
    if (braceStart === -1) return null

    let depth = 0
    let i = braceStart
    let inString: '"' | "'" | null = null
    let escape = false

    for (; i < html.length; i++) {
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
            if (depth === 0) {
                return html.slice(braceStart, i + 1)
            }
        }
    }
    return null
}
