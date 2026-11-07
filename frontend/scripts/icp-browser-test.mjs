import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import WebSocket from 'ws'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const waitForHttp = async (url, attempts = 100) => {
  for (let index = 0; index < attempts; index += 1) {
    try { const response = await fetch(url); if (response.ok) return response } catch {}
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

class Cdp {
  #socket
  #nextId = 1
  #pending = new Map()
  networkUrls = []
  constructor(url) {
    this.#socket = new WebSocket(url)
    this.#socket.on('message', (data) => {
      const message = JSON.parse(data.toString())
      if (message.id) {
        const pending = this.#pending.get(message.id)
        if (!pending) return
        this.#pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
      } else if (message.method === 'Network.requestWillBeSent') {
        this.networkUrls.push(message.params.request.url)
      }
    })
  }
  async open() { if (this.#socket.readyState !== WebSocket.OPEN) await new Promise((resolve) => this.#socket.once('open', resolve)) }
  send(method, params = {}) {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Browser evaluation failed')
    return result.result.value
  }
  close() { this.#socket.terminate() }
}

test('ICP browser flow uses canisters only', { timeout: 60_000 }, async (context) => {
  const profile = mkdtempSync(join(tmpdir(), 'meritocracy-icp-chromium-'))
  const vite = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--mode', 'icp-browser-test'], {
    cwd: new URL('..', import.meta.url), stdio: 'ignore', env: { ...process.env }, detached: true,
  })
  const chromium = spawn('/snap/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=9333', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore', detached: true })
  context.after(() => {
    if (vite.pid) process.kill(-vite.pid, 'SIGTERM')
    if (chromium.pid) process.kill(-chromium.pid, 'SIGTERM')
    rmSync(profile, { recursive: true, force: true })
  })

  await waitForHttp('http://127.0.0.1:5173/icp')
  await waitForHttp('http://127.0.0.1:9333/json/version')
  const pageResponse = await fetch(`http://127.0.0.1:9333/json/new?${encodeURIComponent('http://127.0.0.1:5173/icp')}`, { method: 'PUT' })
  const page = await pageResponse.json()
  const cdp = new Cdp(page.webSocketDebuggerUrl)
  context.after(() => cdp.close())
  await cdp.open()
  await Promise.all([cdp.send('Runtime.enable'), cdp.send('Page.enable'), cdp.send('Network.enable')])

  const waitText = async (text) => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (await cdp.evaluate(`document.body?.innerText.includes(${JSON.stringify(text)}) ?? false`)) return
      await delay(100)
    }
    throw new Error(`Browser did not render text: ${text}`)
  }
  const click = async (text) => {
    const clicked = await cdp.evaluate(`(() => { const element = [...document.querySelectorAll('button')].find((node) => node.textContent?.includes(${JSON.stringify(text)})); if (!element) return false; element.click(); return true })()`)
    assert.equal(clicked, true, `button ${text} must exist`)
  }
  const fillLabel = async (labelText, value) => {
    const filled = await cdp.evaluate(`(() => { const label = [...document.querySelectorAll('label')].find((node) => node.textContent?.includes(${JSON.stringify(labelText)})); const input = label?.querySelector('input,textarea'); if (!input) return false; const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    assert.equal(filled, true, `field ${labelText} must exist`)
  }

  await waitText('Meritocracy on-chain workspace')
  await click('principal session')
  await waitText('Signed in as user 7')

  await click('Add ICRC route')
  await waitText('pending')
  await click('Prove ICRC ownership')
  await waitText('verified')

  await fillLabel('Untrusted evidence text', 'bounded browser integration evidence')
  await fillLabel('Prompt version', '00'.repeat(32))
  await click('Submit synchronously')
  await waitText('#21 · complete')
  await click('View proposal')
  await waitText('Proposal 21: 3/2')

  await click('Open')
  await waitText('Allocation 101 · paid')
  await waitText('at block 987')
  await waitText('recipient-challenged')
  await click('Reconcile')
  await waitText('Reconciliation: matched')

  const apiRequests = cdp.networkUrls.filter((url) => new URL(url).pathname.startsWith('/api'))
  assert.deepEqual(apiRequests, [], `ICP browser flow made Express requests: ${apiRequests.join(', ')}`)
})
