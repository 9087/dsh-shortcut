/** Package-manifest invariants this plugin's loading depends on. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The package manifest as the loader reads it. */
interface Manifest {
  name: string
  main: string
  exports: Record<string, { default?: string }>
  files: string[]
  dsh: {
    bundle: { patch: string }
    client: { platform: string; inject: string[] }
  }
  peerDependencies: Record<string, string>
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as Manifest
const clientSource = readFileSync('src/client/index.ts', 'utf8')
const patch = readFileSync('cordis.patch.yml', 'utf8')

describe('package manifest', () => {
  it('names the package as the profile and the bundle patch expect', () => {
    expect(manifest.name).toBe('dsh-shortcut')
    expect(patch).toContain('name: dsh-shortcut')
    expect(patch).toContain('id: shortcut')
  })

  it('exposes both halves and ships every file the loader opens', () => {
    expect(manifest.main).toBe('lib/index.js')
    expect(manifest.exports['.']?.default).toBe('./lib/index.js')
    expect(manifest.exports['./client']?.default).toBe('./lib/client.js')
    expect(manifest.files).toEqual(expect.arrayContaining([
      'lib/index.js', 'lib/client.js', 'cordis.patch.yml',
    ]))
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  })

  it('declares the web client and the packages whose seats it fills', () => {
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.client.inject).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-sidebar',
    ]))
  })

  it('covers every client service the browser half injects', () => {
    for (const service of ['slots', 'locale', 'connection']) {
      expect(clientSource).toContain(`'${service}'`)
    }
  })

  it('declares no @deepseek-ai/dsh-* peer the 0.2.0-rc.2 guard would reject', () => {
    for (const peer of Object.keys(manifest.peerDependencies)) {
      if (!peer.startsWith('@deepseek-ai/dsh')) continue
      expect(manifest.peerDependencies[peer], `${peer} must accept 0.2.0-rc.2`).toMatch(/\^?0\.2\.0-rc\.2/)
    }
  })
})
