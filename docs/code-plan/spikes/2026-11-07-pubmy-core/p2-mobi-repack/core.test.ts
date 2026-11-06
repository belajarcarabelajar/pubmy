import { describe, expect, test } from 'bun:test'
import { readRecord0Header, sniffMediaType } from './core.ts'

// Synthetic PDB: 78-byte header, one record-offset entry, record 0 at byte 96.
const makePdb = (encryption: number, version: number) => {
    const buf = new Uint8Array(96 + 64)
    const dv = new DataView(buf.buffer)
    buf.set(new TextEncoder().encode('BOOKMOBI'), 60)
    dv.setUint16(76, 1)
    dv.setUint32(78, 96)
    dv.setUint16(96 + 12, encryption)
    buf.set(new TextEncoder().encode('MOBI'), 96 + 16)
    dv.setUint32(96 + 36, version)
    return buf
}

describe('readRecord0Header', () => {
    test('reports PalmDoc encryption 2 (Mobipocket DRM) from record 0 offset 12', () => {
        expect(readRecord0Header(makePdb(2, 8))).toEqual({ encryption: 2, mobiVersion: 8 })
    })
    test('reports encryption 0 for a DRM-free MOBI6', () => {
        expect(readRecord0Header(makePdb(0, 6))).toEqual({ encryption: 0, mobiVersion: 6 })
    })
})

describe('sniffMediaType', () => {
    test('recognizes JPEG, PNG and GIF magic bytes', () => {
        expect(sniffMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
        expect(sniffMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
        expect(sniffMediaType(new TextEncoder().encode('GIF89a'))).toBe('image/gif')
    })
    test('returns null for non-image records such as FLIS', () => {
        expect(sniffMediaType(new TextEncoder().encode('FLIS'))).toBeNull()
    })
})
