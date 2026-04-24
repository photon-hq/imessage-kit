export function normalizeHandle(raw: string): string {
    const trimmed = raw.trim()
    if (!trimmed) throw new Error('Handle is empty')
    if (trimmed.includes('@')) {
        const lower = trimmed.toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) {
            throw new Error(`Invalid email: ${raw}`)
        }
        return lower
    }
    const digits = trimmed.replace(/\D/g, '')
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
    if (digits.length >= 11 && digits.length <= 15) return `+${digits}`
    throw new Error(`Unparseable handle: ${raw}`)
}

export function isPhone(handle: string): boolean {
    return handle.startsWith('+') && /^\+\d{11,15}$/.test(handle)
}

export function isEmail(handle: string): boolean {
    return handle.includes('@')
}
