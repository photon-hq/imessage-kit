import { describe, expect, it } from 'bun:test'
import { VERSION } from '../src/index'

describe('smoke', () => {
    it('exports a version string', () => {
        expect(VERSION).toBe('2.0.0')
    })
})
