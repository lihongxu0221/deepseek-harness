import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PACKAGED_DEFAULT_CORDIS_YML } from '../src/default-cordis-yml.ts'
import {
  JSONRPC_AGENT_NAME,
  SIDECAR_CONFIG_BASENAME,
  isPackagedJsonrpcExecutable,
  jsonrpcAgentUsage,
  resolveJsonrpcAgentConfig,
  type JsonrpcAgentConfigIo,
} from '../src/config-path.ts'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-jsonrpc-config-'))

const PYTHON_DEFAULT = fileURLToPath(new URL(
  '../../../../python/sdk-runtime/src/deepseek_harness_runtime/runtime/cordis.yml',
  import.meta.url,
))

function pluginEntries(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .filter(line => line.trim() !== '' && !line.trimStart().startsWith('#'))
    .join('\n')
}

function io(overrides: Partial<JsonrpcAgentConfigIo> & Pick<JsonrpcAgentConfigIo, 'execDir'>): JsonrpcAgentConfigIo {
  return {
    envPath: undefined,
    argvPath: undefined,
    packaged: false,
    exists: () => false,
    writeFile: () => {
      throw new Error('writeFile should not run')
    },
    warn: () => {
      throw new Error('warn should not run')
    },
    getEnv: () => undefined,
    setEnv: () => {
      throw new Error('setEnv should not run')
    },
    ...overrides,
  }
}

describe('isPackagedJsonrpcExecutable', () => {
  it('treats SEA and the packaged filename prefix as packaged', () => {
    expect(isPackagedJsonrpcExecutable('/usr/bin/node', true)).toBe(true)
    expect(isPackagedJsonrpcExecutable(join(tmp(), 'dsh-jsonrpc-agent-pkg-win-x64.exe'), false)).toBe(true)
    expect(isPackagedJsonrpcExecutable(join(tmp(), 'node.exe'), false)).toBe(false)
    expect(isPackagedJsonrpcExecutable('/usr/bin/node', false)).toBe(false)
  })
})

describe('resolveJsonrpcAgentConfig', () => {
  it('prints usage when unpackaged and no path is named', () => {
    const result = resolveJsonrpcAgentConfig(io({ execDir: tmp() }))
    expect(result).toEqual({ status: 'missing', usage: jsonrpcAgentUsage() })
    expect(result.status === 'missing' && result.usage).toContain(JSONRPC_AGENT_NAME)
  })

  it('prefers a present env path over argv and does not write', () => {
    const dir = tmp()
    const envPath = join(dir, 'from-env.yml')
    writeFileSync(envPath, 'env\n')
    const result = resolveJsonrpcAgentConfig(io({
      execDir: dir,
      envPath,
      argvPath: join(dir, 'from-argv.yml'),
      packaged: true,
      exists: path => path === resolve(envPath),
    }))
    expect(result).toEqual({ status: 'ok', path: resolve(envPath) })
  })

  it('uses argv when env is empty and the named file exists', () => {
    const dir = tmp()
    const argvPath = join(dir, 'from-argv.yml')
    writeFileSync(argvPath, 'argv\n')
    const result = resolveJsonrpcAgentConfig(io({
      execDir: dir,
      envPath: '',
      argvPath,
      exists: path => path === resolve(argvPath),
    }))
    expect(result).toEqual({ status: 'ok', path: resolve(argvPath) })
  })

  it('returns usage when a named path does not exist, even when packaged', () => {
    const dir = tmp()
    const result = resolveJsonrpcAgentConfig(io({
      execDir: dir,
      argvPath: join(dir, 'missing.yml'),
      packaged: true,
      exists: () => false,
    }))
    expect(result).toEqual({ status: 'missing', usage: jsonrpcAgentUsage() })
  })

  it('writes the bundled default next to a packaged executable when the sidecar is absent', () => {
    const execDir = tmp()
    const sidecar = resolve(execDir, SIDECAR_CONFIG_BASENAME)
    const written: string[] = []
    const warnings: string[] = []
    const env: Record<string, string | undefined> = {}
    const result = resolveJsonrpcAgentConfig(io({
      execDir,
      packaged: true,
      exists: () => false,
      writeFile: (path, contents) => {
        written.push(path)
        writeFileSync(path, contents)
      },
      warn: (line) => { warnings.push(line) },
      getEnv: name => env[name],
      setEnv: (name, value) => { env[name] = value },
    }))
    expect(result).toEqual({ status: 'ok', path: sidecar })
    expect(written).toEqual([sidecar])
    expect(readFileSync(sidecar, 'utf8')).toBe(PACKAGED_DEFAULT_CORDIS_YML)
    expect(warnings).toEqual([`${JSONRPC_AGENT_NAME}: wrote default config ${sidecar}\n`])
    expect(env['DSH_CWD']).toBe(execDir)
    expect(env['DSH_SESSION_ROOT']).toBe(join(execDir, '.sessions'))
  })

  it('reuses an existing packaged sidecar without rewriting it', () => {
    const execDir = tmp()
    const sidecar = resolve(execDir, SIDECAR_CONFIG_BASENAME)
    writeFileSync(sidecar, 'existing\n')
    const env: Record<string, string | undefined> = {
      DSH_CWD: '/already/cwd',
      DSH_SESSION_ROOT: '',
    }
    const result = resolveJsonrpcAgentConfig(io({
      execDir,
      packaged: true,
      exists: path => path === sidecar,
      getEnv: name => env[name],
      setEnv: (name, value) => { env[name] = value },
    }))
    expect(result).toEqual({ status: 'ok', path: sidecar })
    expect(readFileSync(sidecar, 'utf8')).toBe('existing\n')
    expect(env['DSH_CWD']).toBe('/already/cwd')
    expect(env['DSH_SESSION_ROOT']).toBe(join(execDir, '.sessions'))
  })

  it('labels a packaged default write failure', () => {
    const execDir = tmp()
    expect(() => resolveJsonrpcAgentConfig(io({
      execDir,
      packaged: true,
      exists: () => false,
      writeFile: () => {
        throw new Error('EACCES')
      },
    }))).toThrow(`${JSONRPC_AGENT_NAME}: failed to write default config ${resolve(execDir, SIDECAR_CONFIG_BASENAME)}: Error: EACCES`)
  })
})

describe('PACKAGED_DEFAULT_CORDIS_YML', () => {
  it('keeps the same plugin entries as the Python runtime default', () => {
    expect(pluginEntries(PACKAGED_DEFAULT_CORDIS_YML)).toBe(pluginEntries(readFileSync(PYTHON_DEFAULT, 'utf8')))
  })

  it('includes the JSON-RPC server entry', () => {
    expect(PACKAGED_DEFAULT_CORDIS_YML).toContain("'@deepseek-ai/dsh-sdk-jsonrpc-server'")
  })
})
