/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import {
  DEFAULT_GATE_MAX_OUTPUT_CHARS,
  DEFAULT_GATE_TIMEOUT_MS,
  DEFAULT_STOP_ON_FAILURE,
  gateResultFromRun,
  parseCiArgs,
  presentCiCall,
  presentCiResult,
  renderCiRunValue,
} from '../src/index.ts'

const RESOLVED = {
  cwd: '/repo',
  gates: ['pnpm lint', 'pnpm test'],
  stopOnFailure: true,
  timeoutMs: 120_000,
  maxOutputChars: 20_000,
}

function makeRun(overrides: Partial<ShellRunResult> = {}): ShellRunResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 120_000,
    stdout: { text: 'stdout', truncated: false },
    stderr: { text: '', truncated: false },
    ...overrides,
  }
}

describe('parseCiArgs', () => {
  it('trims cwd and gates and applies defaults', () => {
    expect(parseCiArgs({ cwd: ' /repo ', gates: [' pnpm lint ', ' pnpm test '] }, RESOLVED)).toEqual({
      cwd: '/repo',
      gates: ['pnpm lint', 'pnpm test'],
      stopOnFailure: RESOLVED.stopOnFailure,
      timeoutMs: RESOLVED.timeoutMs,
    })
  })

  it('honors an explicit stopOnFailure', () => {
    expect(parseCiArgs({ cwd: '/repo', gates: ['x'], stopOnFailure: false }, RESOLVED).stopOnFailure).toBe(false)
  })

  it('rejects an empty cwd', () => {
    expect(() => parseCiArgs({ cwd: '  ', gates: ['x'] }, RESOLVED)).toThrow(/cwd must be a non-empty path/)
  })

  it('rejects an empty gates array', () => {
    expect(() => parseCiArgs({ cwd: '/repo', gates: [] }, RESOLVED)).toThrow(/gates must contain at least one command/)
  })

  it('rejects a blank gate command', () => {
    expect(() => parseCiArgs({ cwd: '/repo', gates: ['x', '  '] }, RESOLVED)).toThrow(/each gate command must be a non-empty string/)
  })
})

describe('gateResultFromRun', () => {
  it('maps a passing run', () => {
    const gate = gateResultFromRun('pnpm lint', makeRun(), 12, 1000, 'passed')
    expect(gate).toMatchObject({ command: 'pnpm lint', status: 'passed', exitCode: 0, signal: null, durationMs: 12 })
  })

  it('maps a non-zero exit', () => {
    const gate = gateResultFromRun('pnpm test', makeRun({ exitCode: 2 }), 5, 1000, 'failed')
    expect(gate.status).toBe('failed')
    expect(gate.exitCode).toBe(2)
    expect(gate.signal).toBeNull()
  })

  it('stringifies a terminating signal', () => {
    const gate = gateResultFromRun('x', makeRun({ exitCode: null, signal: 'SIGTERM' }), 3, 1000, 'failed')
    expect(gate.signal).toBe('SIGTERM')
    expect(gate.exitCode).toBeNull()
  })

  it('caps and flags truncated output', () => {
    const gate = gateResultFromRun('x', makeRun({ stdout: { text: 'a'.repeat(2000), truncated: true } }), 1, 100, 'passed')
    expect(gate.stdout).toBe('a'.repeat(100))
    expect(gate.stdoutTruncated).toBe(true)
  })

  it('marks skipped gates with no output', () => {
    const gate = gateResultFromRun('y', undefined, 0, 1000, 'skipped')
    expect(gate).toMatchObject({ command: 'y', status: 'skipped', stdout: '', stderr: '' })
  })
})

describe('renderCiRunValue', () => {
  it('renders an overall verdict and per-gate lines', () => {
    const text = renderCiRunValue({
      cwd: '/repo',
      overall: 'failed',
      gates: [
        { command: 'pnpm lint', status: 'passed', exitCode: 0, signal: null, timedOut: false, aborted: false, durationMs: 10, stdout: 'ok', stderr: '', stdoutTruncated: false, stderrTruncated: false },
        { command: 'pnpm test', status: 'failed', exitCode: 2, signal: null, timedOut: false, aborted: false, durationMs: 20, stdout: '', stderr: 'boom', stdoutTruncated: false, stderrTruncated: false },
      ],
    })
    expect(text).toContain('Overall: failed')
    expect(text).toContain('## pnpm lint')
    expect(text).toContain('exit 2')
    expect(text).toContain('boom')
  })

  it('marks skipped gates', () => {
    const text = renderCiRunValue({ cwd: '/r', overall: 'failed', gates: [{ command: 'x', status: 'skipped', exitCode: null, signal: null, timedOut: false, aborted: false, durationMs: 0, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false }] })
    expect(text).toContain('skipped (prior gate failed)')
  })
})

describe('presentation', () => {
  it('presentCiCall returns a terminal card', () => {
    expect(presentCiCall({ cwd: '/r', gates: ['a', 'b'] })).toEqual({ card: 'terminal', title: 'a && b', description: 'Run CI quality gates', cwd: '/r' })
  })

  it('presentCiResult falls back to generic when meta is missing', () => {
    expect(presentCiResult({ cwd: '/r', gates: ['a'] }, { isError: false, content: [], meta: undefined } as never)).toBeUndefined()
  })

  it('presentCiResult builds a terminal output with exit code', () => {
    const view = presentCiResult({ cwd: '/r', gates: ['a'] }, { isError: false, content: [], meta: { gates: [{ command: 'a', stdout: 'out', stderr: '', exitCode: 1 }] } } as never)
    expect(view).toMatchObject({ card: 'terminal', exitCode: 1 })
    expect(view?.output).toContain('out')
  })
})

describe('defaults', () => {
  it('exports stable defaults', () => {
    expect(DEFAULT_GATE_TIMEOUT_MS).toBe(120_000)
    expect(DEFAULT_GATE_MAX_OUTPUT_CHARS).toBe(20_000)
    expect(DEFAULT_STOP_ON_FAILURE).toBe(true)
  })
})
