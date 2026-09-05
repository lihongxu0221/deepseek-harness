import { describe, expect, it } from 'vitest'
import { callUpdate, parseUpdateResponse } from '../src/client/api.ts'

describe('parseUpdateResponse', () => {
  it('rejects failed HTTP and parses a status object', async () => {
    await expect(parseUpdateResponse(new Response('', { status: 403 })))
      .rejects.toThrow('HTTP 403')
    await expect(parseUpdateResponse(new Response('', { status: 404 })))
      .rejects.toThrow('HTTP 404')
    await expect(parseUpdateResponse(new Response('', { status: 500 })))
      .rejects.toThrow('HTTP 500')
    await expect(parseUpdateResponse(new Response('null', { status: 200 })))
      .rejects.toThrow('not an object')
    await expect(parseUpdateResponse(new Response('[]', { status: 200 })))
      .rejects.toThrow('not an object')
    await expect(parseUpdateResponse(new Response('{"outdated":true}', { status: 200 })))
      .rejects.toThrow('missing mode')
    expect(await parseUpdateResponse(new Response(JSON.stringify({
      mode: 'downloading',
      outdated: true,
      current: '1',
      latest: '2',
      notes: 'n',
      error: 'e',
      assetName: 'a.zip',
      progress: { received: 1, total: 2 },
    }), { status: 200 }))).toEqual({
      mode: 'downloading',
      outdated: true,
      current: '1',
      latest: '2',
      notes: 'n',
      error: 'e',
      assetName: 'a.zip',
      progress: { received: 1, total: 2 },
    })
    expect(await parseUpdateResponse(new Response(JSON.stringify({
      mode: 'idle', progress: { received: 'nope' },
    }), { status: 200 }))).toEqual({ mode: 'idle', outdated: false })
  })
})

describe('callUpdate', () => {
  it('posts to the updater prefix', async () => {
    const request: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('/api/desktop-update/check')
      expect(init?.method).toBe('POST')
      return new Response(JSON.stringify({ mode: 'idle' }), { status: 200 })
    }
    expect(await callUpdate('/check', 'POST', request)).toEqual({ mode: 'idle', outdated: false })
  })
})
