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
 *   interface again. All tests passed. The middleware does not compensate:
 *   `Host` is chosen by the client, so a non-browser LAN client sends a loopback
 *   `Host` and `Origin` and passes both checks. The binding is the only thing
 *   keeping the app off the LAN.
 * - Point `config.matcher` at a path that does not exist and the middleware runs
 *   on nothing. All tests passed.
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
        else if (/^route\.[jt]sx?$/.test(e.name)) routes.push(full)
      }
    }
    walk(appDir)
    expect(routes.length).toBeGreaterThan(0)

    // No regex. Three rounds of this test matched handler SPELLINGS and three
    // times a spelling was missed — `export const POST`, `export { h as POST }`,
    // `export * from`, `export const { POST } =`. The property needs none of
    // them: every route file belongs under `api/`, so a `route.*` anywhere else
    // is the finding, whatever it exports.
    //
    // Deliberately stricter than "state-changing routes outside /api". This PR
    // moved the loopback pin ABOVE the method gate because reads need it too,
    // so a read-only route outside `/api` is equally unreachable by it — and a
    // filter that only looked for write handlers kept the old scoping the PR
    // exists to correct.
    const offenders = routes
      .map((f) => path.relative(appDir, f).split(path.sep).join('/'))
      .filter((r) => !r.startsWith('api/'))
    expect(offenders, 'route handlers outside /api are not covered by the matcher').toEqual([])
  })

  it('no Server Action smuggles a write past the matcher', () => {
    // A Server Action is a POST to a PAGE route, which `/api/:path*` never sees.
    // None exist today; this fails the moment one is added.
    // Walk the project, don't allow-list directories. This started as app/+lib/,
    // gained components/ when an action there was shown to run, and was still a
    // three-name list — so `hooks/` and `actions/` walked straight past it, and
    // `next build` registers an action in either. A new top-level directory is
    // not a new bypass to discover; the exclude set is what has to be wrong for
    // this to miss now.
    const skip = new Set(['node_modules', '.next', '.git', 'tests', 'scripts'])
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(e.name)) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.[jt]sx?$/.test(e.name) && /^\s*['"]use server['"]/m.test(fs.readFileSync(full, 'utf8')))
          found.push(full)
      }
    }
    walk(path.resolve(__dirname, '../..'))
    expect(found, 'Server Actions are POSTs to page routes, outside the matcher').toEqual([])
  })

  it('dev and start still bind loopback only', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')
    ) as { scripts: Record<string, string> }
    // Anchored and counted, over BOTH spellings of the flag. `toContain(...)`
    // was a prefix match, so `127.0.0.10` (a different address) and
    // `127.0.0.1.nip.io` (a DNS name an attacker controls) satisfied it; and
    // because a later hostname flag wins, appending one bound every interface
    // while the string was still present. The anchor closes the first two, the
    // count closes the third — and matching `-H` as well as `--hostname` is what
    // closes the fourth: `-H` is Next's own short form, so counting only the
    // long spelling left `--hostname 127.0.0.1 -H 0.0.0.0` green while the
    // server listened on every interface.
    for (const s of ['dev', 'start'] as const) {
      const cmd = pkg.scripts[s]
      expect(cmd, `${s} must bind loopback`).toMatch(/(?:--hostname|-H)[=\s]*127\.0\.0\.1(?:\s|$)/)
      expect(cmd.match(/--hostname|-H/g) ?? [], `${s}: a later hostname flag wins`).toHaveLength(1)
    }
  })

  it('Start.bat opens the address the binding actually serves', () => {
    // The pairing the .bat comment describes. 127.0.0.1 listens on IPv4 loopback
    // only — nothing listens on ::1. `localhost` may resolve to ::1 first, which
    // is untested on Windows, so the launcher uses the address that cannot depend
    // on the resolver. Nothing enforced the pairing either.
    // Anchored to the launch line itself. `toContain` was satisfied by any
    // occurrence anywhere in the file — including the comment above — and the
    // negative ruled out only one wrong spelling, so a comment mentioning the
    // address plus a launcher on 0.0.0.0 passed both.
    //
    // The PORT is the other half of the address, and it was a literal 3000 with
    // nothing tying it to the script. `Start.bat` runs `npm run dev`, so adding
    // `--port 4000` there left this green while the launcher opened a dead port
    // — the same pairing failure the host half exists to prevent. Derived from
    // the script now, over both spellings of the flag.
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')
    ) as { scripts: Record<string, string> }
    const port = pkg.scripts.dev.match(/(?:--port|-p)[=\s]*(\d+)/)?.[1] ?? '3000'
    const bat = fs.readFileSync(path.resolve(__dirname, '../../../Start.bat'), 'utf8')
    expect(bat, `Start.bat must open the port \`npm run dev\` serves (${port})`).toMatch(
      new RegExp(String.raw`^start http://127\.0\.0\.1:${port}\s*$`, 'm'),
    )
  })
})
