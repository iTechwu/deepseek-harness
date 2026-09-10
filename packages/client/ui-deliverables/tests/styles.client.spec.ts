import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/Deliverables.module.css', import.meta.url)), 'utf8')

function rule(selector: string): string {
  const match = new RegExp(`\\${selector} \\{([^}]*)\\}`, 'u').exec(css)
  if (match === null) throw new Error(`Deliverables.module.css has no ${selector} rule`)
  return match[1] ?? ''
}

describe('Deliverables theme surface styles', () => {
  it('uses adaptive theme fills instead of static neutral colors', () => {
    expect(rule('.root')).toContain('--deliverable-fill: var(--dsw-alias-bg-layer-2)')
    expect(rule('.root')).toContain('--deliverable-hover: var(--dsw-alias-interactive-bg-hover)')
    expect(css).not.toContain('dsw-static-neutral-')
  })

  it('keeps delivery cards and nested controls within the shared 8px radius', () => {
    expect(rule('.file')).toContain('border-radius: 8px')
    expect(rule('.fileIcon')).toContain('border-radius: 8px')
    expect(rule('.split')).toContain('border-radius: 8px')
  })
})
