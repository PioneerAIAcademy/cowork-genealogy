import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../../middleware'

/**
 * That the control is wired at all (#1018 review).
 *
 * `middleware.test.ts` proves the logic decides correctly. Neither of the two
 * things that make that logic *run* was pinned by anything:
 *
 * - Remove `--hostname 127.0.0.1` from `dev` and `start` and the app binds every
 *   interface again. All 176 tests passed. The middleware still refuses LAN
 *   writes — the Host would not be loopback — but every read route is
 *   deliberately uncovered, so the whole annotation corpus becomes readable from
 *   the LAN with a green build.
 * - Point `config.matcher` at a path that does not exist and the middleware runs
 *   on nothing. All 176 tests passed.
 *
 * The module header calls the binding "the other half of this control … neither
 * is sufficient alone", and `Start.bat` carries "do not change the binding
 * without changing this URL". Both were prose nothing enforced.
 *
 * The matcher half was filed in #2037 behind a ruleset decision it does not
 * depend on — the required-check half needs the lead; asserting a string does
 * not.
 */

describe('the control is actually wired', () => {
  it('the matcher still covers every API route', () => {
    // Every state-changing route lives under /api. A typo here disables the
    // control everywhere with no other symptom.
    expect(config.matcher).toBe('/api/:path*')
  })

  it('dev and start still bind loopback only', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')
    ) as { scripts: Record<string, string> }
    expect(pkg.scripts.dev).toContain('--hostname 127.0.0.1')
    expect(pkg.scripts.start).toContain('--hostname 127.0.0.1')
  })

  it('Start.bat opens the address the binding actually serves', () => {
    // The pairing the .bat comment describes. 127.0.0.1 listens on IPv4 loopback
    // only — nothing listens on ::1. `localhost` may resolve to ::1 first, which
    // is untested on Windows, so the launcher uses the address that cannot depend
    // on the resolver. Nothing enforced the pairing either.
    const bat = fs.readFileSync(path.resolve(__dirname, '../../../Start.bat'), 'utf8')
    expect(bat).toContain('127.0.0.1:3000')
    expect(bat).not.toMatch(/start http:\/\/localhost:3000/)
  })
})
