import fs from 'fs'
import path from 'path'

const baseDir = (global.process && global.process.pkg) ? path.dirname(process.execPath) : process.cwd()
const dataDir = path.resolve(baseDir, 'data')
const dbPath = path.join(dataDir, 'db.json')
const logPath = path.join(dataDir, 'ops.log')
const secretPath = path.join(dataDir, 'secret.json')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({ users: [], categories: [], accounts: [], sessions: [], user_ops: [] }, null, 2))
if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '')
if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, JSON.stringify({ secret: Math.random().toString(36).slice(2) }))

function read() {
  const obj = JSON.parse(fs.readFileSync(dbPath, 'utf-8'))
  if (!obj.users) obj.users = []
  if (!obj.categories) obj.categories = []
  if (!obj.accounts) obj.accounts = []
  if (!obj.sessions) obj.sessions = []
  if (!obj.user_ops) obj.user_ops = []
  for (const s of obj.sessions) {
    if (!Array.isArray(s.segments)) s.segments = s.end_time ? [] : [{ start_time: s.start_time, end_time: null }]
  }
  return obj
}

function write(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2))
}

function nextId(arr) {
  let m = 0
  for (const x of arr) if (x.id > m) m = x.id
  return m + 1
}

export function createCategory(name) {
  const db = read()
  if (db.categories.find(c => c.name === name)) throw new Error('category_exists')
  const id = nextId(db.categories)
  db.categories.push({ id, name })
  write(db)
  log({ type: 'create_category', data: { id, name } })
  return id
}

export function listCategories() {
  const db = read()
  return db.categories.map(c => {
    const sessions = db.sessions.filter(s => s.category_id === c.id && s.status === 'stopped' && s.total_ms && s.total_amount)
    const count = sessions.length
    const averageMs = count ? sessions.reduce((a, b) => a + b.total_ms, 0) / count : 0
    const averageAmount = count ? sessions.reduce((a, b) => a + b.total_amount, 0) / count : 0
    return { id: c.id, name: c.name, stats: { count, averageMs, averageAmount } }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export function createAccount(categoryId, name) {
  const db = read()
  if (!db.categories.find(c => c.id === categoryId)) throw new Error('category_missing')
  if (db.accounts.find(a => a.category_id === categoryId && a.name === name)) throw new Error('account_exists')
  const id = nextId(db.accounts)
  db.accounts.push({ id, category_id: categoryId, name })
  write(db)
  log({ type: 'create_account', data: { id, categoryId, name } })
  return id
}

export function listAccounts(categoryId) {
  const db = read()
  return db.accounts.filter(a => a.category_id === categoryId).sort((a, b) => a.name.localeCompare(b.name))
}

export function startSession({ categoryId, accountId, hourlyRate }) {
  const db = read()
  const now = Date.now()
  if (db.sessions.find(s => s.category_id === categoryId && s.account_id === accountId && s.status === 'running')) {
    return db.sessions.find(s => s.category_id === categoryId && s.account_id === accountId && s.status === 'running').id
  }
  const id = nextId(db.sessions)
  db.sessions.push({
    id,
    category_id: categoryId,
    account_id: accountId,
    hourly_rate: hourlyRate,
    start_time: now,
    end_time: null,
    total_ms: null,
    total_amount: null,
    status: 'running',
    segments: [{ start_time: now, end_time: null }]
  })
  write(db)
  log({ type: 'start_session', data: { id, categoryId, accountId, hourlyRate, start_time: now } })
  return id
}

export function getSession(sessionId) {
  const db = read()
  return db.sessions.find(s => s.id === sessionId)
}

export function getActiveSession(categoryId, accountId) {
  const db = read()
  return db.sessions.find(s => s.category_id === categoryId && s.account_id === accountId && s.status === 'running')
}

export function pauseSession(sessionId) {
  const db = read()
  const now = Date.now()
  const s = db.sessions.find(x => x.id === sessionId)
  if (!s) return false
  const open = s.segments.find(seg => !seg.end_time)
  if (!open) return false
  open.end_time = now
  s.status = 'paused'
  write(db)
  log({ type: 'pause_session', data: { id: sessionId, time: now } })
  return true
}

export function resumeSession(sessionId) {
  const db = read()
  const now = Date.now()
  const s = db.sessions.find(x => x.id === sessionId)
  if (!s) return false
  s.segments.push({ start_time: now, end_time: null })
  s.status = 'running'
  write(db)
  log({ type: 'resume_session', data: { id: sessionId, time: now } })
  return true
}

export function stopSession(sessionId) {
  const db = read()
  const now = Date.now()
  const s = db.sessions.find(x => x.id === sessionId)
  if (!s) return { totalMs: 0, amount: 0 }
  const last = s.segments.find(seg => !seg.end_time)
  if (last) last.end_time = now
  const totalMs = s.segments.reduce((acc, seg) => acc + Math.max(0, (seg.end_time || 0) - seg.start_time), 0)
  const amount = (totalMs / 3600000) * s.hourly_rate
  s.end_time = now
  s.total_ms = totalMs
  s.total_amount = amount
  s.status = 'stopped'
  write(db)
  log({ type: 'stop_session', data: { id: sessionId, end_time: now, total_ms: totalMs, total_amount: amount } })
  return { totalMs, amount }
}

export function sessionStatus(sessionId) {
  const db = read()
  const s = db.sessions.find(x => x.id === sessionId)
  if (!s) return null
  let totalMs = 0
  for (const seg of s.segments) {
    const end = seg.end_time || Date.now()
    totalMs += end - seg.start_time
  }
  const estimatedAmount = (totalMs / 3600000) * s.hourly_rate
  return { session: s, totalMs, estimatedAmount }
}

export function listSessionsByCategory(categoryId) {
  const db = read()
  return db.sessions.filter(s => s.category_id === categoryId).sort((a, b) => b.start_time - a.start_time)
}

export function recommendationForCategory(categoryId) {
  const db = read()
  const sessions = db.sessions.filter(s => s.category_id === categoryId && s.status === 'stopped')
  const count = sessions.length
  const averageMs = count ? sessions.reduce((a, b) => a + (b.total_ms || 0), 0) / count : 0
  const averageAmount = count ? sessions.reduce((a, b) => a + (b.total_amount || 0), 0) / count : 0
  return { averageMs, averageAmount }
}

function log(entry) {
  const line = JSON.stringify({ ts: Date.now(), ...entry }) + '\n'
  fs.appendFileSync(logPath, line)
  const db = read()
  db.user_ops.push({ id: nextId(db.user_ops), ts: Date.now(), user_id: entry.userId || null, type: entry.type, data: entry.data })
  write(db)
}

export function querySessions({ userId, categoryId, accountId, from, to, status }) {
  const db = read()
  let arr = db.sessions
  if (userId) arr = arr.filter(s => s.user_id === Number(userId))
  if (categoryId) arr = arr.filter(s => s.category_id === Number(categoryId))
  if (accountId) arr = arr.filter(s => s.account_id === Number(accountId))
  if (status) arr = arr.filter(s => s.status === status)
  if (from) arr = arr.filter(s => s.start_time >= Number(from))
  if (to) arr = arr.filter(s => (s.end_time || Date.now()) <= Number(to))
  return arr
}

export function statsSummary(filter) {
  const arr = querySessions({ ...filter, status: 'stopped' })
  const n = arr.length
  if (!n) return { count: 0, totalMs: 0, avgMs: 0, minMs: 0, maxMs: 0, totalAmount: 0, avgAmount: 0, minAmount: 0, maxAmount: 0 }
  const ms = arr.map(x => x.total_ms || 0)
  const amt = arr.map(x => x.total_amount || 0)
  const sumMs = ms.reduce((a, b) => a + b, 0)
  const sumAmt = amt.reduce((a, b) => a + b, 0)
  return {
    count: n,
    totalMs: sumMs,
    avgMs: sumMs / n,
    minMs: Math.min(...ms),
    maxMs: Math.max(...ms),
    totalAmount: sumAmt,
    avgAmount: sumAmt / n,
    minAmount: Math.min(...amt),
    maxAmount: Math.max(...amt)
  }
}

function bucketStart(ts, g) {
  const d = new Date(ts)
  if (g === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (g === 'week') {
    const day = d.getDay() || 7
    const start = new Date(d)
    start.setDate(d.getDate() - (day - 1))
    return new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  }
  if (g === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  if (g === 'quarter') return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime()
  if (g === 'year') return new Date(d.getFullYear(), 0, 1).getTime()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function seriesStats(filter, granularity) {
  const arr = querySessions({ ...filter, status: 'stopped' })
  const map = new Map()
  for (const s of arr) {
    const key = bucketStart(s.start_time, granularity || 'day')
    const prev = map.get(key) || { count: 0, totalMs: 0, totalAmount: 0 }
    map.set(key, { count: prev.count + 1, totalMs: prev.totalMs + (s.total_ms || 0), totalAmount: prev.totalAmount + (s.total_amount || 0) })
  }
  const out = Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, ...v }))
  return out
}

export function distribution(filter, field, bins) {
  const arr = querySessions({ ...filter, status: 'stopped' })
  const values = arr.map(s => (field === 'total_amount' ? (s.total_amount || 0) : (s.total_ms || 0)))
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const k = Math.max(1, Number(bins) || 10)
  const width = (max - min) / k || 1
  const hist = Array.from({ length: k }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }))
  for (const v of values) {
    const idx = Math.min(k - 1, Math.max(0, Math.floor((v - min) / width)))
    hist[idx].count += 1
  }
  return { min, max, bins: hist }
}

export function pie(filter, by) {
  const arr = querySessions({ ...filter, status: 'stopped' })
  const db = read()
  const keyName = by === 'account' ? (id => (db.accounts.find(a => a.id === id)?.name || String(id))) : (id => (db.categories.find(c => c.id === id)?.name || String(id)))
  const map = new Map()
  for (const s of arr) {
    const key = by === 'account' ? s.account_id : s.category_id
    const prev = map.get(key) || 0
    map.set(key, prev + (s.total_amount || 0))
  }
  return Array.from(map.entries()).map(([k, v]) => ({ key: keyName(k), value: v }))
}

export function exportData(filter, fields) {
  const arr = querySessions(filter)
  const list = arr.map(s => {
    const obj = {}
    for (const f of fields && fields.length ? fields : ['id','category_id','account_id','hourly_rate','start_time','end_time','total_ms','total_amount','status']) obj[f] = s[f]
    return obj
  })
  return list
}

function uniqueKey(s) {
  return [s.category_id, s.account_id, s.start_time, s.hourly_rate].join('|')
}

export function importData(records, { onDuplicate }) {
  const db = read()
  const idx = new Map()
  for (const s of db.sessions) idx.set(uniqueKey(s), s)
  let added = 0, skipped = 0, overwritten = 0, merged = 0
  for (const r of records) {
    const key = uniqueKey(r)
    const ex = idx.get(key)
    if (!ex) {
      const id = nextId(db.sessions)
      const s = { id, category_id: r.category_id, account_id: r.account_id, hourly_rate: r.hourly_rate, start_time: r.start_time, end_time: r.end_time || null, total_ms: r.total_ms || null, total_amount: r.total_amount || null, status: r.status || (r.end_time ? 'stopped' : 'running'), segments: r.segments || (r.end_time ? [] : [{ start_time: r.start_time, end_time: null }]) }
      db.sessions.push(s)
      idx.set(key, s)
      added++
      log({ type: 'import_add', data: { id } })
    } else {
      if (onDuplicate === 'skip') { skipped++; continue }
      if (onDuplicate === 'overwrite') {
        ex.end_time = r.end_time || ex.end_time
        ex.total_ms = r.total_ms || ex.total_ms
        ex.total_amount = r.total_amount || ex.total_amount
        ex.status = r.status || ex.status
        ex.segments = r.segments || ex.segments
        overwritten++
        log({ type: 'import_overwrite', data: { id: ex.id } })
      } else if (onDuplicate === 'merge') {
        ex.end_time = r.end_time || ex.end_time
        ex.total_ms = Math.max(ex.total_ms || 0, r.total_ms || 0)
        ex.total_amount = Math.max(ex.total_amount || 0, r.total_amount || 0)
        ex.status = r.status || ex.status
        merged++
        log({ type: 'import_merge', data: { id: ex.id } })
      } else { skipped++; continue }
    }
  }
  write(db)
  return { added, skipped, overwritten, merged }
}

export function createUser(username) {
  const db = read()
  if (db.users.find(u => u.username === username)) throw new Error('username_exists')
  const id = nextId(db.users)
  const user = { id, username, created_at: Date.now() }
  db.users.push(user)
  write(db)
  log({ type: 'create_user', data: { id, username }, userId: id })
  return user
}

export function findUserByName(username) {
  const db = read()
  return db.users.find(u => u.username === username)
}

export function getUserById(id) {
  const db = read()
  return db.users.find(u => u.id === id)
}

export function createCategoryForUser(userId, name) {
  const db = read()
  if (db.categories.find(c => c.user_id === userId && c.name === name)) throw new Error('category_exists')
  const id = nextId(db.categories)
  db.categories.push({ id, user_id: userId, name })
  write(db)
  log({ type: 'create_category', data: { id, name }, userId })
  return id
}

export function listCategoriesForUser(userId) {
  const db = read()
  return db.categories.filter(c => c.user_id === userId).map(c => {
    const sessions = db.sessions.filter(s => s.category_id === c.id && s.user_id === userId && s.status === 'stopped' && s.total_ms && s.total_amount)
    const count = sessions.length
    const averageMs = count ? sessions.reduce((a, b) => a + b.total_ms, 0) / count : 0
    const averageAmount = count ? sessions.reduce((a, b) => a + b.total_amount, 0) / count : 0
    return { id: c.id, name: c.name, stats: { count, averageMs, averageAmount } }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export function createAccountForUser(userId, categoryId, name) {
  const db = read()
  if (!db.categories.find(c => c.id === categoryId && c.user_id === userId)) throw new Error('category_missing')
  if (db.accounts.find(a => a.category_id === categoryId && a.user_id === userId && a.name === name)) throw new Error('account_exists')
  const id = nextId(db.accounts)
  db.accounts.push({ id, user_id: userId, category_id: categoryId, name })
  write(db)
  log({ type: 'create_account', data: { id, categoryId, name }, userId })
  return id
}

export function listAccountsForUser(userId, categoryId) {
  const db = read()
  return db.accounts.filter(a => a.category_id === categoryId && a.user_id === userId).sort((a, b) => a.name.localeCompare(b.name))
}

export function startSessionForUser(userId, { categoryId, accountId, hourlyRate }) {
  const db = read()
  const now = Date.now()
  const existing = db.sessions.find(s => s.user_id === userId && s.category_id === categoryId && s.account_id === accountId && s.status === 'running')
  if (existing) return existing.id
  const id = nextId(db.sessions)
  db.sessions.push({
    id,
    user_id: userId,
    category_id: categoryId,
    account_id: accountId,
    hourly_rate: hourlyRate,
    start_time: now,
    end_time: null,
    total_ms: null,
    total_amount: null,
    status: 'running',
    segments: [{ start_time: now, end_time: null }]
  })
  write(db)
  log({ type: 'start_session', data: { id, categoryId, accountId, hourlyRate, start_time: now }, userId })
  return id
}

export function getActiveSessionForUser(userId, categoryId, accountId) {
  const db = read()
  return db.sessions.find(s => s.user_id === userId && s.category_id === categoryId && s.account_id === accountId && s.status === 'running')
}

export function userSummaryStats(userId) {
  return statsSummary({ userId })
}

export function globalSummaryStats() {
  return statsSummary({})
}

export function readSecret() {
  const obj = JSON.parse(fs.readFileSync(secretPath, 'utf-8'))
  return obj.secret
}

export function updateSessionsForUser(userId, ids, { categoryId, accountId }, { admin } = {}) {
  const db = read()
  const set = new Set(ids.map(Number))
  let updated = 0
  let targetCategory = null
  let targetAccount = null
  if (categoryId) targetCategory = db.categories.find(c => c.id === Number(categoryId) && (admin || c.user_id === Number(userId)))
  if (accountId) targetAccount = db.accounts.find(a => a.id === Number(accountId) && (admin || a.user_id === Number(userId)))
  if (accountId && categoryId && targetAccount && targetAccount.category_id !== Number(categoryId)) throw new Error('account_category_mismatch')
  for (const s of db.sessions) {
    if (!set.has(Number(s.id))) continue
    if (!admin && s.user_id !== Number(userId)) continue
    if (categoryId) s.category_id = Number(categoryId)
    if (accountId) s.account_id = Number(accountId)
    updated++
  }
  write(db)
  log({ type: 'batch_update_sessions', data: { ids, categoryId, accountId, updated }, userId })
  return { updated }
}

export function deleteSessionsForUser(userId, ids, { admin } = {}) {
  const db = read()
  const set = new Set(ids.map(Number))
  const before = db.sessions.length
  db.sessions = db.sessions.filter(s => {
    if (!set.has(Number(s.id))) return true
    if (!admin && s.user_id !== Number(userId)) return true
    return false
  })
  const deleted = before - db.sessions.length
  write(db)
  log({ type: 'batch_delete_sessions', data: { ids, deleted }, userId })
  return { deleted }
}

export default {}