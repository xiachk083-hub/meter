import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import {
  createCategoryForUser,
  listCategoriesForUser,
  createAccountForUser,
  listAccountsForUser,
  startSessionForUser,
  getActiveSessionForUser,
  pauseSession,
  resumeSession,
  stopSession,
  sessionStatus,
  listSessionsByCategory,
  recommendationForCategory,
  statsSummary,
  seriesStats,
  distribution,
  pie,
  exportData,
  importData,
  createUser,
  findUserByName,
  getUserById,
  readSecret,
  querySessions,
  updateSessionsForUser,
  deleteSessionsForUser
} from './db.js'
import crypto from 'crypto'
import xlsx from 'xlsx'
import { getStatus as getSyncStatus, setConfig as setSyncConfig, saveAll as saveCloud, pullAll as pullCloud, queueChange, checkHealth } from './cloud.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

function parseCookies(req) {
  const hdr = req.headers.cookie || ''
  const out = {}
  hdr.split(';').forEach(p => { const i = p.indexOf('='); if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1)) })
  return out
}

function verifyToken(token) {
  try {
    const [payload, sig] = String(token || '').split('.')
    const secret = readSecret()
    const calc = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    if (calc !== sig) return null
    const [uidStr, tsStr] = payload.split(':')
    const uid = Number(uidStr)
    const ts = Number(tsStr)
    if (!uid || !ts) return null
    if (Date.now() - ts > 30 * 24 * 3600 * 1000) return null
    return getUserById(uid) || null
  } catch { return null }
}

function signToken(userId) {
  const payload = `${userId}:${Date.now()}`
  const secret = readSecret()
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${sig}`
}

function authMiddleware(req, _res, next) {
  const cookies = parseCookies(req)
  const user = verifyToken(cookies.auth)
  req.user = user || null
  next()
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' })
  next()
}

function isAdmin(req) {
  return !!(req.user && req.user.username === 'xiach')
}

app.use(authMiddleware)

app.post('/api/auth/register', (req, res) => {
  const { username } = req.body
  if (!username) return res.status(400).json({ error: 'username_required' })
  try {
    const user = createUser(String(username))
    const token = signToken(user.id)
    res.setHeader('Set-Cookie', `auth=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`)
    return res.json({ id: user.id, username: user.username })
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/auth/login', (req, res) => {
  const { username } = req.body
  if (!username) return res.status(400).json({ error: 'username_required' })
  const user = findUserByName(String(username))
  if (!user) return res.status(404).json({ error: 'user_not_found' })
  const token = signToken(user.id)
  res.setHeader('Set-Cookie', `auth=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`)
  res.json({ id: user.id, username: user.username })
})

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
  res.json({ ok: true })
})

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' })
  res.json({ id: req.user.id, username: req.user.username })
})

app.post('/api/categories', requireAuth, (req, res) => {
  const { name } = req.body
  try {
    const id = createCategoryForUser(req.user.id, name)
    queueChange({ type: 'category_create', userId: req.user.id, id })
    res.json({ id })
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.get('/api/categories', requireAuth, (req, res) => {
  res.json(listCategoriesForUser(req.user.id))
})

app.get('/api/categories/:id/sessions', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  if (isAdmin(req)) return res.json(listSessionsByCategory(id))
  const list = querySessions({ userId: req.user.id, categoryId: id }).sort((a, b) => b.start_time - a.start_time)
  res.json(list)
})

app.get('/api/categories/:id/recommendation', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  if (isAdmin(req)) return res.json(recommendationForCategory(id))
  const s = statsSummary({ categoryId: id, userId: req.user.id })
  res.json({ averageMs: s.avgMs || 0, averageAmount: s.avgAmount || 0 })
})

app.post('/api/accounts', requireAuth, (req, res) => {
  const { categoryId, name } = req.body
  try {
    const id = createAccountForUser(req.user.id, Number(categoryId), name)
    queueChange({ type: 'account_create', userId: req.user.id, id })
    res.json({ id })
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.get('/api/accounts', requireAuth, (req, res) => {
  const { categoryId } = req.query
  res.json(listAccountsForUser(req.user.id, Number(categoryId)))
})

app.post('/api/sessions/start', requireAuth, (req, res) => {
  const { categoryId, accountId, hourlyRate } = req.body
  try {
    const existing = getActiveSessionForUser(req.user.id, categoryId, accountId)
    if (existing) return res.json({ id: existing.id })
    const id = startSessionForUser(req.user.id, { categoryId, accountId, hourlyRate })
    queueChange({ type: 'start', userId: req.user.id, id })
    res.json({ id })
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/sessions/pause', requireAuth, (req, res) => {
  const { sessionId } = req.body
  const ok = pauseSession(Number(sessionId))
  queueChange({ type: 'pause', userId: req.user.id, id: Number(sessionId) })
  res.json({ ok })
})

app.post('/api/sessions/resume', requireAuth, (req, res) => {
  const { sessionId } = req.body
  const ok = resumeSession(Number(sessionId))
  queueChange({ type: 'resume', userId: req.user.id, id: Number(sessionId) })
  res.json({ ok })
})

app.post('/api/sessions/stop', requireAuth, (req, res) => {
  const { sessionId } = req.body
  const r = stopSession(Number(sessionId))
  queueChange({ type: 'stop', userId: req.user.id, id: Number(sessionId) })
  res.json(r)
})

app.get('/api/sessions/:id/status', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  const s = sessionStatus(id)
  if (!s) return res.status(404).json({ error: 'not_found' })
  res.json(s)
})

app.get('/api/stats/summary', requireAuth, (req, res) => {
  const { categoryId, accountId, from, to, scope } = req.query
  const filter = { categoryId, accountId, from, to }
  if (scope === 'global') {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden_global' })
  } else {
    filter.userId = req.user.id
  }
  res.json(statsSummary(filter))
})

app.get('/api/stats/series', requireAuth, (req, res) => {
  const { categoryId, accountId, from, to, granularity, scope } = req.query
  const filter = { categoryId, accountId, from, to }
  if (scope === 'global') {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden_global' })
  } else {
    filter.userId = req.user.id
  }
  res.json(seriesStats(filter, granularity || 'day'))
})

app.get('/api/stats/distribution', requireAuth, (req, res) => {
  const { categoryId, accountId, from, to, field, bins, scope } = req.query
  const filter = { categoryId, accountId, from, to }
  if (scope === 'global') {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden_global' })
  } else {
    filter.userId = req.user.id
  }
  res.json(distribution(filter, field || 'total_amount', Number(bins) || 10))
})

app.get('/api/stats/pie', requireAuth, (req, res) => {
  const { categoryId, accountId, from, to, by, scope } = req.query
  const filter = { categoryId, accountId, from, to }
  if (scope === 'global') {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden_global' })
  } else {
    filter.userId = req.user.id
  }
  res.json(pie(filter, by || 'account'))
})

app.get('/api/export', requireAuth, (req, res) => {
  const { categoryId, accountId, from, to, format, fields, scope } = req.query
  const filter = { categoryId, accountId, from, to }
  if (scope === 'global') {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden_global' })
  } else {
    filter.userId = req.user.id
  }
  const list = exportData(filter, fields ? String(fields).split(',') : undefined)
  const fmt = (format || 'json').toLowerCase()
  if (fmt === 'json') {
    res.setHeader('Content-Type', 'application/json')
    return res.send(JSON.stringify(list))
  }
  if (fmt === 'csv') {
    const cols = Object.keys(list[0] || {})
    const rows = [cols.join(',')].concat(list.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(',')))
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="export.csv"')
    return res.send(rows.join('\n'))
  }
  if (fmt === 'xlsx') {
    const ws = xlsx.utils.json_to_sheet(list)
    const wb = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(wb, ws, 'data')
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="export.xlsx"')
    return res.send(buf)
  }
  res.status(400).json({ error: 'format_unsupported' })
})

app.post('/api/import', requireAuth, (req, res) => {
  const { records, onDuplicate } = req.body
  if (!Array.isArray(records)) return res.status(400).json({ error: 'invalid_records' })
  const r = importData(records, { onDuplicate: onDuplicate || 'skip' })
  res.json(r)
})

app.get('/api/sessions', requireAuth, (req, res) => {
  const { categoryId, accountId, from, to, status, scope } = req.query
  const filter = { categoryId, accountId, from, to, status }
  if (scope === 'global') {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden_global' })
  } else {
    filter.userId = req.user.id
  }
  res.json(querySessions(filter).sort((a, b) => b.start_time - a.start_time))
})

app.patch('/api/sessions/batch', requireAuth, (req, res) => {
  const { ids, categoryId, accountId, scope } = req.body
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_required' })
  try {
    const r = updateSessionsForUser(req.user.id, ids, { categoryId, accountId }, { admin: isAdmin(req) && scope === 'global' })
    res.json(r)
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.delete('/api/sessions/batch', requireAuth, (req, res) => {
  const { ids, scope } = req.body
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_required' })
  const r = deleteSessionsForUser(req.user.id, ids, { admin: isAdmin(req) && scope === 'global' })
  res.json(r)
})

app.post('/api/sessions/batch/update', requireAuth, (req, res) => {
  const { ids, categoryId, accountId, scope } = req.body
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_required' })
  try {
    const r = updateSessionsForUser(req.user.id, ids, { categoryId, accountId }, { admin: isAdmin(req) && scope === 'global' })
    queueChange({ type: 'batch_update', ids, userId: req.user.id })
    res.json(r)
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/sessions/batch/delete', requireAuth, (req, res) => {
  const { ids, scope } = req.body
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_required' })
  const r = deleteSessionsForUser(req.user.id, ids, { admin: isAdmin(req) && scope === 'global' })
  queueChange({ type: 'batch_delete', ids, userId: req.user.id })
  res.json(r)
})

app.get('/api/sync/status', requireAuth, (req, res) => {
  res.json(getSyncStatus())
})

app.post('/api/sync/config', requireAuth, (req, res) => {
  const { enabled, intervalMs } = req.body
  setSyncConfig({ enabled, intervalMs })
  res.json(getSyncStatus())
})

app.post('/api/sync/save', requireAuth, async (req, res) => {
  try { await saveCloud(); res.json(getSyncStatus()) } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.post('/api/sync/pull', requireAuth, async (req, res) => {
  try { await pullCloud(); res.json(getSyncStatus()) } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.get('/api/sync/health', requireAuth, async (req, res) => {
  try { const h = await checkHealth(); res.json(h) } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

function firstExisting(paths) {
  for (const p of paths) {
    if (!p) continue
    try { if (fs.existsSync(p)) return p } catch {}
  }
  return null
}

const pkgPublic = (global.process && global.process.pkg) ? path.join(path.dirname(process.execPath), 'public') : null
const publicDir = path.resolve(__dirname, '../public')
const rootIndex = path.resolve(__dirname, '../index.html')
const staticDir = firstExisting([publicDir, pkgPublic])
if (staticDir) app.use(express.static(staticDir))

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  const indexPath = firstExisting([
    staticDir ? path.join(staticDir, 'index.html') : null,
    rootIndex
  ])
  if (indexPath) return res.sendFile(indexPath)
  res.status(404).send('Not Found')
})

export default app