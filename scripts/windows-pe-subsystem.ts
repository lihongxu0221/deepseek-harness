/**
 * Patch a Windows PE executable between CUI (console) and GUI subsystems.
 * pkg SEA emits a console Node host; the packaged Web desktop needs GUI so
 * Explorer does not open a console beside the splash and tray.
 * @module windows-pe-subsystem
 */

import { readFileSync, writeFileSync } from 'node:fs'

/** IMAGE_DOS_SIGNATURE ('MZ'). */
const IMAGE_DOS_SIGNATURE = 0x5a4d
/** IMAGE_NT_SIGNATURE ('PE\0\0'). */
const IMAGE_NT_SIGNATURE = 0x00004550
/** PE32 optional-header magic. */
const IMAGE_NT_OPTIONAL_HDR32_MAGIC = 0x10b
/** PE32+ optional-header magic. */
const IMAGE_NT_OPTIONAL_HDR64_MAGIC = 0x20b
/** Offset of Subsystem inside the optional header, PE32 and PE32+. */
const SUBSYSTEM_OFFSET = 68
/** IMAGE_SUBSYSTEM_WINDOWS_GUI */
export const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2
/** IMAGE_SUBSYSTEM_WINDOWS_CUI */
export const IMAGE_SUBSYSTEM_WINDOWS_CUI = 3

const SUBSYSTEM_BY_NAME = {
  gui: IMAGE_SUBSYSTEM_WINDOWS_GUI,
  cui: IMAGE_SUBSYSTEM_WINDOWS_CUI,
} as const

/** Named Windows PE subsystem. */
export type WindowsPeSubsystem = keyof typeof SUBSYSTEM_BY_NAME

/**
 * Locate the optional-header Subsystem field in a PE image.
 * @param buffer - file contents; must be a PE image.
 * @returns the byte offset of the 2-byte Subsystem field.
 */
export function peSubsystemOffset(buffer: Buffer): number {
  if (buffer.length < 64 || buffer.readUInt16LE(0) !== IMAGE_DOS_SIGNATURE) {
    throw new Error('windows-pe-subsystem: not an MZ executable')
  }
  const peOffset = buffer.readUInt32LE(0x3c)
  if (peOffset + 24 + SUBSYSTEM_OFFSET + 2 > buffer.length) {
    throw new Error('windows-pe-subsystem: truncated PE headers')
  }
  if (buffer.readUInt32LE(peOffset) !== IMAGE_NT_SIGNATURE) {
    throw new Error('windows-pe-subsystem: missing PE signature')
  }
  const optionalHeader = peOffset + 4 + 20
  const magic = buffer.readUInt16LE(optionalHeader)
  if (magic !== IMAGE_NT_OPTIONAL_HDR32_MAGIC && magic !== IMAGE_NT_OPTIONAL_HDR64_MAGIC) {
    throw new Error('windows-pe-subsystem: unsupported optional-header magic ' + String(magic))
  }
  return optionalHeader + SUBSYSTEM_OFFSET
}

/**
 * Read the current Subsystem value from a PE image.
 * @param buffer - file contents; must be a PE image.
 * @returns the Subsystem field.
 */
export function readPeSubsystem(buffer: Buffer): number {
  return buffer.readUInt16LE(peSubsystemOffset(buffer))
}

/**
 * Write the Subsystem field in a PE image in place.
 * @param buffer - file contents; must be a PE image.
 * @param subsystem - IMAGE_SUBSYSTEM_WINDOWS_GUI or IMAGE_SUBSYSTEM_WINDOWS_CUI.
 */
export function writePeSubsystem(buffer: Buffer, subsystem: number): void {
  if (subsystem !== IMAGE_SUBSYSTEM_WINDOWS_GUI && subsystem !== IMAGE_SUBSYSTEM_WINDOWS_CUI) {
    throw new Error('windows-pe-subsystem: unsupported subsystem ' + String(subsystem))
  }
  buffer.writeUInt16LE(subsystem, peSubsystemOffset(buffer))
}

/**
 * Set a Windows executable to GUI or CUI. The caller passes the packaged
 * launcher path after pkg writes it.
 * @param file - absolute path of the PE image.
 * @param subsystem - gui hides the console; cui restores it.
 */
export function setWindowsPeSubsystem(file: string, subsystem: WindowsPeSubsystem): void {
  const buffer = readFileSync(file)
  writePeSubsystem(buffer, SUBSYSTEM_BY_NAME[subsystem])
  writeFileSync(file, buffer)
}
