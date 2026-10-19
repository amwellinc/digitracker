import { describe, it, expect } from 'vitest'
import { isValidDataAgentStoragePath } from '../dataAgentStoragePath'

describe('isValidDataAgentStoragePath', () => {
  it('accepts the real shape NewMigrationModal produces', () => {
    expect(isValidDataAgentStoragePath('AM333/3f2a1b4c-9d8e-4f6a-8b1c-2d3e4f5a6b7c-contacts.csv', 'AM333')).toBe(true)
  })

  it('rejects a path that does not start with the subAccount prefix', () => {
    expect(isValidDataAgentStoragePath('OTHER/file.csv', 'AM333')).toBe(false)
  })

  it('rejects a bare subAccount with nothing after the slash', () => {
    expect(isValidDataAgentStoragePath('AM333/', 'AM333')).toBe(false)
  })

  it('rejects a traversal sequence smuggled past the subAccount prefix', () => {
    expect(isValidDataAgentStoragePath('AM333/../../../rest/v1/users?select=*', 'AM333')).toBe(false)
  })

  it('rejects a percent-encoded traversal sequence', () => {
    expect(isValidDataAgentStoragePath('AM333/%2e%2e%2fother-bucket/a.csv', 'AM333')).toBe(false)
  })

  it('rejects an extra path separator even with no literal ".."', () => {
    expect(isValidDataAgentStoragePath('AM333/sub/dir/file.csv', 'AM333')).toBe(false)
  })

  it('rejects a query-string or fragment injection', () => {
    expect(isValidDataAgentStoragePath('AM333/file.csv?x=1', 'AM333')).toBe(false)
    expect(isValidDataAgentStoragePath('AM333/file.csv#frag', 'AM333')).toBe(false)
  })

  it('rejects a backslash', () => {
    expect(isValidDataAgentStoragePath('AM333/..\\other', 'AM333')).toBe(false)
  })
})
