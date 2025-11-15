import express from 'express'
import cors from 'cors'
import path from 'path'
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

async function verifyToken(token) {
  try {
    const [payload, sig] = String(token || '').split('.')
    const secret = await readSecret()
    const calc = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    if (calc !== sig) return null
    const [uidStr, tsStr] = payload.split(':')
    const uid = Number(uidStr)
    const ts = Number(tsStr)
    if (!uid || !ts) return null
    if (Date.now() - ts > 30 * 24 * 3600 * 1000) return null
    return await getUserById(uid) || null
  } catch { return null }
}

async function signToken(userId) {
  const payload = `${userId}:${Date.now()}`
  const secret = await readSecret()
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${sig}`
}

async function authMiddleware(req, _res, next) {
  const cookies = parseCookies(req)
  const user = await verifyToken(cookies.auth)
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

app.post('/api/auth/register', async (req, res) => {
  const { username } = req.body
  if (!username) return res.status(400).json({ error: 'username_required' })
  try {
    const user = await createUser(String(username))
    const token = await signToken(user.id)
    res.setHeader('Set-Cookie', `auth=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`)
    return res.json({ id: user.id, username: user.username })
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const { username } = req.body
  if (!username) return res.status(400).json({ error: 'username_required' })
  const user = await findUserByName(String(username))
  if (!user) return res.status(404).json({ error: 'user_not_found' })
  const token = await signToken(user.id)
  res.setHeader('Set-Cookie', `auth=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`)
  res.json({ id: user.id, username: user.username })
})

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
  res.json({ ok: true })
})

app.get('/api/auth/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' })
  res.json({ id: req.user.id, username: req.user.username })
})

app.post('/api/categories', requireAuth, async (req, res) => {
  const { name } = req.body
  try {
    const id = await createCategoryForUser(req.user.id, name)
    res.json({ id })
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.get('/api/categories', requireAuth, async (req, res) => {
  res.json(await listCategoriesForUser(req.user.id))
})

app.get('/api/categories/:id/sessions', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (isAdmin(req)) return res.json(await listSessionsByCategory(id))
  const list = (await querySessions({ userId: req.user.id, categoryId: id })).sort((a, b) => b.start_time - a.start_time)
  res.json(list)
})

app.get('/api/categories/:id/recommendation', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (isAdmin(req)) return res.json(await recommendationForCategory(id))
  const s = await statsSummary({ categoryId: id, userId: req.user.id })
  res.json({ averageMs: s.avgMs || 0, averageAmount: s.avgAmount || 0 })
})

app.post('/api/accounts', requireAuth, async (req, res) => {
  const { categoryId, name } = req.body
  try {
    const id = await createAccountForUser(req.user.id, Number(categoryId), name)
    res.json({ id })
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.get('/api/accounts', requireAuth, async (req, res) => {
  const { categoryId } = req.query
  res.json(await listAccountsForUser(req.user.id, Number(categoryId)))
})

app.post('/api/sessions/start', requireAuth, async (req, res) => {
  const { categoryId, accountId, hourlyRate } = req.body
  try {
    const existing = await getActiveSessionForUser(req.user.id, categoryId, accountId)
    if (existing) return res.json({ id: existing.id })
    const id = await startSessionForUser(req.user.id, { categoryId, accountId, hourlyRate })
    res.json({ id })
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/sessions/pause', requireAuth, async (req, res) => {
  const { sessionId } = req.body
  const ok = await pauseSession(Number(sessionId))
  res.json({ ok })
})

app.post('/api/sessions/resume', requireAuth, async (req, res) => {
  const { sessionId } = req.body
  const ok = await resumeSession(Number(sessionId))
  res.json({ ok })
})

app.post('/api/sessions/stop', requireAuth, async (req, res) => {
  const { sessionId } = req.body
  const r = await stopSession(Number(sessionId))
  res.json(r)
})

app.get('/api/sessions/:id/status', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const s = await sessionStatus(id)
  if (!s) return res.status(404).json({ error: 'not_found' })
  res.json(s)
})

app.get('/api/stats/summary', requireAuth, async (req, res) => {
  const { categoryId, accountId, from, to, scope } = req.query
  const filter = { categoryId, accountId, from, to }
  if (scope === 'global') {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden_global' })
  } else {
    filter.userId = req.user.id
  }
  res.json(await statsSummary(filter))
})

app.get('/api/stats/series', requireAuth, async (req, res) => {
  const { categoryId, accountId, from, to, granularity, scope } = req.query
  const filter = { categoryId, accountId, from, to }
  if (scope === 'global') {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden_global' })
  } else {
    filter.userId = req.user.id
  }
  res.json(await seriesStats(filter, granularity || 'day'))
})

app.get('/api/stats/distribution', requireAuth, async (req, res) => {
  const { categoryId, accountId, from, to, field, bins, scope } = req.query
  const filter = { categoryId, accountId, from, to }
  if (scope === 'global') {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden_global' })
  } else {
    filter.userId = req.user.id
  }
  res.json(await distribution(filter, field || 'total_amount', Number(bins) || 10))
})

app.get('/api/stats/pie', requireAuth, async (req, res) => {
  const { categoryId, accountId, from, to, by, scope } = req.query
  const filter = { categoryId, accountId, from, to }
  if (scope === 'global') {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden_global' })
  } else {
    filter.userId = req.user.id
  }
  res.json(await pie(filter, by || 'account'))
})

app.get('/api/export', requireAuth, async (req, res) => {
  const { categoryId, accountId, from, to, format, fields, scope } = req.query
  const filter = { categoryId, accountId, from, to }
  if (scope === 'global') {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden_global' })
  } else {
    filter.userId = req.user.id
  }
  const list = await exportData(filter, fields ? String(fields).split(',') : undefined)
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

app.post('/api/import', requireAuth, async (req, res) => {
  const { records, onDuplicate } = req.body
  if (!Array.isArray(records)) return res.status(400).json({ error: 'invalid_records' })
  const r = await importData(records, { onDuplicate: onDuplicate || 'skip' })
  res.json(r)
})

app.get('/api/sessions', requireAuth, async (req, res) => {
  const { categoryId, accountId, from, to, status, scope } = req.query
  const filter = { categoryId, accountId, from, to, status }
  if (scope === 'global') {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden_global' })
  } else {
    filter.userId = req.user.id
  }
  res.json((await querySessions(filter)).sort((a, b) => b.start_time - a.start_time))
})

app.patch('/api/sessions/batch', requireAuth, async (req, res) => {
  const { ids, categoryId, accountId, scope } = req.body
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_required' })
  try {
    const r = await updateSessionsForUser(req.user.id, ids, { categoryId, accountId }, { admin: isAdmin(req) && scope === 'global' })
    res.json(r)
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.delete('/api/sessions/batch', requireAuth, async (req, res) => {
  const { ids, scope } = req.body
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_required' })
  const r = await deleteSessionsForUser(req.user.id, ids, { admin: isAdmin(req) && scope === 'global' })
  res.json(r)
})

app.post('/api/sessions/batch/update', requireAuth, async (req, res) => {
  const { ids, categoryId, accountId, scope } = req.body
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_required' })
  try {
    const r = await updateSessionsForUser(req.user.id, ids, { categoryId, accountId }, { admin: isAdmin(req) && scope === 'global' })
    res.json(r)
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/sessions/batch/delete', requireAuth, async (req, res) => {
  const { ids, scope } = req.body
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_required' })
  const r = await deleteSessionsForUser(req.user.id, ids, { admin: isAdmin(req) && scope === 'global' })
  res.json(r)
})

const staticDir = (global.process && global.process.pkg) ? path.join(path.dirname(process.execPath), 'public') : path.resolve(__dirname, '../public')
app.use(express.static(staticDir))

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.sendFile(path.join(staticDir, 'index.html'))
})

export default app