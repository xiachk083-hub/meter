import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { read as readLocal, write as writeLocal } from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const enabled = !!(supabaseUrl && supabaseKey)
const client = enabled ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } }) : null

const state = { enabled, intervalMs: 300000, timer: null, lastSaveAt: 0, lastPullAt: 0, running: false, progress: '', logs: [] }

const dataDir = process.env.VERCEL ? '/tmp' : ((global.process && global.process.pkg) ? path.dirname(process.execPath) : process.cwd())
const queuePath = path.join(dataDir, 'data', 'sync-queue.json')

function ensureQueueFile() {
  const dir = path.dirname(queuePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(queuePath)) fs.writeFileSync(queuePath, JSON.stringify([]))
}

function readQueue() { ensureQueueFile(); return JSON.parse(fs.readFileSync(queuePath, 'utf-8')) }
function writeQueue(q) { ensureQueueFile(); fs.writeFileSync(queuePath, JSON.stringify(q)) }

export function queueChange(entry) {
  const q = readQueue()
  q.push({ ts: Date.now(), entry })
  writeQueue(q)
}

async function upsert(name, rows) {
  if (!client) throw new Error('supabase disabled')
  const { error } = await client.from(name).upsert(rows, { onConflict: 'id' })
  if (error) throw error
}

async function fetchAll(name) {
  if (!client) throw new Error('supabase disabled')
  const { data, error } = await client.from(name).select('*')
  if (error) throw error
  return data || []
}

export async function saveAll() {
  state.running = true; state.progress = 'saving'
  try {
    const db = readLocal()
    const now = Date.now()
    const stamp = r => ({ ...r, updated_at: r.updated_at || now })
    await upsert('users', db.users.map(stamp))
    await upsert('categories', db.categories.map(stamp))
    await upsert('accounts', db.accounts.map(stamp))
    await upsert('sessions', db.sessions.map(stamp))
    await upsert('user_ops', db.user_ops.map(stamp))
    const q = readQueue(); if (q.length) { await upsert('user_ops', q.map(x => ({ id: undefined, ts: x.ts, type: 'queue', data: x.entry }))); writeQueue([]) }
    state.lastSaveAt = Date.now(); state.logs.push({ t: state.lastSaveAt, msg: 'saved' })
  } catch (e) { state.logs.push({ t: Date.now(), msg: 'save_error:' + String(e.message || e) }) } finally { state.running = false; state.progress = '' }
}

export async function pullAll() {
  state.running = true; state.progress = 'pulling'
  try {
    const remote = {
      users: await fetchAll('users'),
      categories: await fetchAll('categories'),
      accounts: await fetchAll('accounts'),
      sessions: await fetchAll('sessions'),
      user_ops: await fetchAll('user_ops')
    }
    const local = readLocal()
    function merge(name) {
      const byId = new Map()
      for (const r of local[name]) byId.set(r.id, r)
      for (const r of remote[name]) {
        const l = byId.get(r.id)
        if (!l) byId.set(r.id, r)
        else {
          const lu = l.updated_at || 0
          const ru = r.updated_at || 0
          byId.set(r.id, ru >= lu ? r : l)
        }
      }
      return Array.from(byId.values())
    }
    const merged = {
      users: merge('users'),
      categories: merge('categories'),
      accounts: merge('accounts'),
      sessions: merge('sessions'),
      user_ops: merge('user_ops')
    }
    writeLocal(merged)
    state.lastPullAt = Date.now(); state.logs.push({ t: state.lastPullAt, msg: 'pulled' })
  } catch (e) { state.logs.push({ t: Date.now(), msg: 'pull_error:' + String(e.message || e) }) } finally { state.running = false; state.progress = '' }
}

export function getStatus() { return { enabled: state.enabled, intervalMs: state.intervalMs, lastSaveAt: state.lastSaveAt, lastPullAt: state.lastPullAt, running: state.running, progress: state.progress, logs: state.logs.slice(-50) } }

export function setConfig({ enabled: en, intervalMs }) {
  if (typeof en === 'boolean') state.enabled = en
  if (intervalMs) state.intervalMs = Math.max(15000, Number(intervalMs))
  restartTimer()
}

function restartTimer() {
  if (state.timer) { clearInterval(state.timer); state.timer = null }
  if (state.enabled) { state.timer = setInterval(() => { saveAll() }, state.intervalMs) }
}

restartTimer()