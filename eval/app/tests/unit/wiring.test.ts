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
    // A typo here disables the control everywhere with no other symptom.
    expect(config.matcher).toBe('/api/:path*')
  })

  it('every state-changing route actually sits under the matcher', () => {
    // The assertion above pins a STRING. The property it relies on — that every
    // state-changing route lives under /api — is what a new route can break
    // while that string stays correct: add app/foo/route.ts exporting POST and
    // the control is bypassed with the matcher untouched. This walks the tree
    // instead of trusting the comment.
    const appDir = path.resolve(__dirname, '../../app')
    const routes: string[] = []
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/^route\.tsx?$/.test(e.name)) routes.push(full)
      }
    }
    walk(appDir)
    expect(routes.length).toBeGreaterThan(0)

    const offenders = routes.filter((f) => {
      const src = fs.readFileSync(f, 'utf8')
      const stateChanging = /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/.test(src)
      const underApi = path
        .relative(appDir, f)
        .split(path.sep)
        .join('/')
        .startsWith('api/')
      return stateChanging && !underApi
    })
    expect(offenders, 'state-changing routes outside /api are not covered by the matcher').toEqual([])
  })

  it('no Server Action smuggles a write past the matcher', () => {
    // A Server Action is a POST to a PAGE route, which `/api/:path*` never sees.
    // None exist today; this fails the moment one is added.
    const roots = [path.resolve(__dirname, '../../app'), path.resolve(__dirname, '../../lib')]
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(e.name) && /^\s*['"]use server['"]/m.test(fs.readFileSync(full, 'utf8')))
          found.push(full)
      }
    }
    for (const r of roots) walk(r)
    expect(found, 'Server Actions are POSTs to page routes, outside the matcher').toEqual([])
  })

  it('dev and start still bind loopback only', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')
    ) as { scripts: Record<string, string> }
    // Anchored and counted, for the same reason as the Start.bat check below.
    // `toContain('--hostname 127.0.0.1')` was a prefix match, so `127.0.0.10`
    // (a different address) and `127.0.0.1.nip.io` (a DNS name an attacker
    // controls) both satisfied it; and because a later `--hostname` wins,
    // appending `--hostname 0.0.0.0` bound every interface while still
    // containing the string. Each of those three passed. The anchor alone
    // closes the first two — the count is what closes the third.
    for (const s of ['dev', 'start'] as const) {
      const cmd = pkg.scripts[s]
      expect(cmd, `${s} must bind loopback`).toMatch(/--hostname 127\.0\.0\.1(\s|$)/)
      expect(cmd.match(/--hostname/g) ?? [], `${s}: a later --hostname wins`).toHaveLength(1)
    }
  })

  it('Start.bat opens the address the binding actually serves', () => {
    // The pairing the .bat comment describes. 127.0.0.1 listens on IPv4 loopback
    // only — nothing listens on ::1. `localhost` may resolve to ::1 first, which
    // is untested on Windows, so the launcher uses the address that cannot depend
    // on the resolver. Nothing enforced the pairing either.
    const bat = fs.readFileSync(path.resolve(__dirname, '../../../Start.bat'), 'utf8')
    // Anchored to the launch line itself. `toContain` was satisfied by any
    // occurrence anywhere in the file — including the comment above — and the
    // negative ruled out only one wrong spelling, so a comment mentioning the
    // address plus a launcher on 0.0.0.0 passed both.
    expect(bat).toMatch(/^start http:\/\/127\.0\.0\.1:3000\s*$/m)
  })
})
