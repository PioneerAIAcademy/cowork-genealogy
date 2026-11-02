#!/usr/bin/env node
// U28: drive the real SPA under a path prefix (or at the root) and fail on anything the
// browser is told that escapes it. `make proto-prefix-check` runs it against the
// docker-compose.prefix.yml edge; BASE=http://127.0.0.1:8085 runs it unprefixed against a
// plain `make proto-up` stack. Billed: one one-line turn. Needs `make proto-grant` first.
//
//   BASE      the SPA's public URL (default the prefixed edge)
//   EMAIL     dev-login email (default dev@localhost, turn.py's DEV_LOGIN_EMAIL)
//   HOLD_S    idle hold after the reply, seconds (default 70; must exceed the edge's 45 s cut)
//   TURN_S    how long to wait for the reply, seconds (default 300)
//   HEADED=1  show the browser
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../../../eval/app/package.json', import.meta.url))

const BASE = (process.env.BASE || 'http://127.0.0.1:8090/service/search/agent-tools/web').replace(/\/+$/, '')
const EMAIL = process.env.EMAIL || 'dev@localhost'
const HOLD_S = Number(process.env.HOLD_S || 70)
const TURN_S = Number(process.env.TURN_S || 300)
const MESSAGE = 'Reply with the single word ok.'
const STREAM = /\/api\/sessions\/[^/]+\/events\/stream$/

if (!Number.isFinite(HOLD_S) || HOLD_S < 60 || !Number.isFinite(TURN_S) || TURN_S <= 0) {
  console.error(`check: HOLD_S must be >= 60 and TURN_S > 0 (got HOLD_S=${process.env.HOLD_S}, TURN_S=${process.env.TURN_S})`)
  process.exit(2)
}

let chromium
try {
  ;({ chromium } = require('@playwright/test'))
} catch (err) {
  console.error(`check: cannot load @playwright/test from eval/app (${err.code || err.message}); run \`make install\``)
  process.exit(2)
}

const base = new URL(BASE)
const prefix = base.pathname.replace(/\/+$/, '')
const failures = []
const fail = (msg) => {
  failures.push(msg)
  console.error(`FAIL: ${msg}`)
}
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`)

const requests = []
// Signed out, the SPA learns it from a 401 on auth/me; that one is expected.
let signedInAt = Infinity

function inPrefix(pathname) {
  return !prefix || pathname === prefix || pathname.startsWith(`${prefix}/`)
}

async function main() {
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' })
  const context = await browser.newContext()
  await context.addInitScript(() => {
    const Native = window.EventSource
    const record = (window.__esLog = { opens: [], errors: [] })
    window.EventSource = class extends Native {
      constructor(url, init) {
        super(url, init)
        this.addEventListener('open', () => record.opens.push({ t: Date.now(), url: String(url) }))
        this.addEventListener('error', () =>
          record.errors.push({ t: Date.now(), url: String(url), readyState: this.readyState })
        )
      }
    }
  })

  const byRequest = new Map()
  context.on('request', (req) => {
    const row = { url: req.url(), method: req.method(), start: Date.now(), end: null, status: null, failure: null }
    byRequest.set(req, row)
    requests.push(row)
  })
  context.on('response', (res) => {
    const row = byRequest.get(res.request())
    if (row) row.status = res.status()
  })
  context.on('requestfinished', (req) => {
    const row = byRequest.get(req)
    if (row) row.end = Date.now()
  })
  context.on('requestfailed', (req) => {
    const row = byRequest.get(req)
    if (row) {
      row.end = Date.now()
      row.failure = req.failure()?.errorText ?? 'failed'
    }
  })

  try {
    const page = await context.newPage()

    log(`open ${BASE} (no trailing slash)`)
    const bare = await page.goto(BASE)
    if (!bare || bare.status() >= 400) fail(`GET ${BASE} answered ${bare?.status()}`)
    await page.locator('#email').waitFor({ timeout: 30_000 })

    log(`open ${BASE}/`)
    const slash = await page.goto(`${BASE}/`)
    if (!slash || slash.status() >= 400) fail(`GET ${BASE}/ answered ${slash?.status()}`)

    for (const path of ['api/health/', 'auth/config/?x=1']) {
      const res = await context.request.get(`${BASE}/${path}`, { maxRedirects: 0 })
      const location = res.headers().location
      const target = location === undefined ? null : new URL(location, `${BASE}/${path}`)
      log(`GET ${path} -> ${res.status()} ${location}`)
      if (!target || target.origin !== base.origin || !inPrefix(target.pathname)) {
        fail(`GET ${BASE}/${path} answered ${res.status()} to ${location}, want a redirect under ${prefix}/ on ${base.origin}`)
      }
    }

    log(`dev-login as ${EMAIL}`)
    await page.locator('#email').fill(EMAIL)
    signedInAt = Date.now()
    await page.getByRole('button', { name: 'Continue' }).click()
    const newSession = page.getByRole('button', { name: '+ New research session' })
    await newSession.waitFor({ timeout: 30_000 })

    log('create a session')
    await newSession.click()
    await page.waitForFunction(() => /^#\/s\/[^/?#]+/.test(window.location.hash), null, { timeout: 30_000 })
    const box = page.locator('textarea.chatTextarea')
    await page.waitForFunction(
      () => {
        const el = document.querySelector('textarea.chatTextarea')
        return el && el.placeholder !== 'Connecting…'
      },
      null,
      { timeout: 30_000 }
    )

    log(`send ${JSON.stringify(MESSAGE)}`)
    await box.fill(MESSAGE)
    await page.locator('button.chatSend').click()
    await page.waitForFunction(
      () =>
        !document.querySelector('button.chatStop') &&
        [...document.querySelectorAll('.msgAssistant .msgText')].some((el) => el.textContent.trim()),
      null,
      { timeout: TURN_S * 1000, polling: 500 }
    )
    const reply = (await page.locator('.msgAssistant .msgText').last().textContent())?.trim() ?? ''
    if (await page.locator('.msgAssistant .msgError').count()) fail(`the turn ended in an error: ${reply.slice(0, 200)}`)
    log(`reply: ${JSON.stringify(reply.slice(0, 120))}`)

    log(`hold the stream idle for ${HOLD_S} s`)
    const holdStart = Date.now()
    await page.waitForTimeout(HOLD_S * 1000)
    const holdEnd = Date.now()

    const streams = requests.filter(
      (r) => STREAM.test(new URL(r.url).pathname) && r.start <= holdEnd && (r.end === null || r.end >= holdStart)
    )
    if (streams.length !== 1) {
      fail(`${streams.length} events/stream requests live during the ${HOLD_S} s hold (want exactly 1): ` +
        streams.map((r) => `${r.url} start=${r.start - holdStart}ms end=${r.end === null ? 'open' : `${r.end - holdStart}ms`}`).join('; '))
    } else if (streams[0].end !== null) {
      fail(`the events/stream request ended ${streams[0].end - holdStart} ms into the hold (${streams[0].failure ?? 'finished'})`)
    }
    const esLog = await page.evaluate(() => window.__esLog)
    if (!esLog) fail('the EventSource hook did not install')
    const esErrors = (esLog?.errors ?? []).filter((e) => e.t >= holdStart && e.t <= holdEnd)
    if (esErrors.length) fail(`${esErrors.length} EventSource error(s) during the hold: ${JSON.stringify(esErrors)}`)

    const cookie = (await context.cookies(`${BASE}/`)).find((c) => c.name === 'wb_session')
    const wantPath = prefix || '/'
    if (!cookie) fail('no wb_session cookie after dev-login')
    else if (cookie.path !== wantPath) fail(`wb_session cookie path is ${JSON.stringify(cookie.path)}, want ${JSON.stringify(wantPath)}`)
  } catch (err) {
    fail(`${err.name}: ${err.message.split('\n')[0]}`)
  } finally {
    await browser.close()
  }

  for (const r of requests) {
    const u = new URL(r.url)
    if (u.origin === base.origin && !inPrefix(u.pathname)) fail(`${r.method} ${r.url} is outside the prefix ${prefix}/`)
    const signedOutProbe = r.status === 401 && r.start < signedInAt && u.pathname === `${prefix}/auth/me`
    if (r.status !== null && r.status >= 400 && !signedOutProbe) fail(`${r.method} ${r.url} answered ${r.status}`)
  }

  log(`${requests.length} requests recorded`)
  if (failures.length) {
    console.error(`\nproto-prefix-check: ${failures.length} failure(s) against ${BASE}`)
    process.exit(1)
  }
  console.log(`\nproto-prefix-check: PASS against ${BASE}`)
}

main().catch((err) => {
  console.error(`check: ${err.stack || err}`)
  process.exit(2)
})
