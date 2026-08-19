import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  IMAGE_SUBSYSTEM_WINDOWS_CUI,
  IMAGE_SUBSYSTEM_WINDOWS_GUI,
  peSubsystemOffset,
  readPeSubsystem,
  setWindowsPeSubsystem,
  writePeSubsystem,
} from './windows-pe-subsystem.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Build a tiny PE32+ image with the Subsystem field set.
 * @param subsystem - IMAGE_SUBSYSTEM value.
 * @param magic - optional-header magic; default PE32+.
 * @returns the image bytes.
 */
function fakePe(subsystem: number, magic = 0x20b): Buffer {
  const buffer = Buffer.alloc(0x200, 0)
  buffer.writeUInt16LE(0x5a4d, 0)
  buffer.writeUInt32LE(0x80, 0x3c)
  buffer.writeUInt32LE(0x00004550, 0x80)
  buffer.writeUInt16LE(magic, 0x80 + 4 + 20)
  buffer.writeUInt16LE(subsystem, 0x80 + 4 + 20 + 68)
  return buffer
}

describe('windows-pe-subsystem', () => {
  it('reads and writes GUI and CUI subsystem values in a PE32+ image', () => {
    const buffer = fakePe(IMAGE_SUBSYSTEM_WINDOWS_CUI)
    expect(readPeSubsystem(buffer)).toBe(IMAGE_SUBSYSTEM_WINDOWS_CUI)
    writePeSubsystem(buffer, IMAGE_SUBSYSTEM_WINDOWS_GUI)
    expect(readPeSubsystem(buffer)).toBe(IMAGE_SUBSYSTEM_WINDOWS_GUI)
    expect(peSubsystemOffset(buffer)).toBe(0x80 + 24 + 68)
  })

  it('accepts PE32 optional-header magic', () => {
    const buffer = fakePe(IMAGE_SUBSYSTEM_WINDOWS_GUI, 0x10b)
    expect(readPeSubsystem(buffer)).toBe(IMAGE_SUBSYSTEM_WINDOWS_GUI)
  })

  it('rejects buffers that are not PE images', () => {
    expect(() => readPeSubsystem(Buffer.from('not pe'))).toThrow(/not an MZ executable/)
    const mz = Buffer.alloc(0x80, 0)
    mz.writeUInt16LE(0x5a4d, 0)
    mz.writeUInt32LE(0x40, 0x3c)
    expect(() => readPeSubsystem(mz)).toThrow(/truncated PE headers/)
    const missing = fakePe(IMAGE_SUBSYSTEM_WINDOWS_CUI)
    missing.writeUInt32LE(0, 0x80)
    expect(() => readPeSubsystem(missing)).toThrow(/missing PE signature/)
    const magic = fakePe(IMAGE_SUBSYSTEM_WINDOWS_CUI)
    magic.writeUInt16LE(0x10c, 0x80 + 24)
    expect(() => readPeSubsystem(magic)).toThrow(/unsupported optional-header magic/)
    expect(() => writePeSubsystem(fakePe(IMAGE_SUBSYSTEM_WINDOWS_CUI), 1)).toThrow(/unsupported subsystem/)
  })

  it('persists the GUI subsystem to disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pe-'))
    roots.push(root)
    const file = join(root, 'dsh-web.exe')
    writeFileSync(file, fakePe(IMAGE_SUBSYSTEM_WINDOWS_CUI))
    setWindowsPeSubsystem(file, 'gui')
    expect(readPeSubsystem(readFileSync(file))).toBe(IMAGE_SUBSYSTEM_WINDOWS_GUI)
    setWindowsPeSubsystem(file, 'cui')
    expect(readPeSubsystem(readFileSync(file))).toBe(IMAGE_SUBSYSTEM_WINDOWS_CUI)
  })
})
