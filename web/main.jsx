import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Chart from 'chart.js/auto'

const api = {
  me: () => fetch('/api/auth/me', { credentials: 'include' }).then(async r => { const ct = r.headers.get('content-type') || ''; if (!r.ok || !ct.includes('application/json')) return null; return r.json() }),
  login: (username) => fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) }).then(r => r.json()),
  register: (username) => fetch('/api/auth/register', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) }).then(r => r.json()),
  logout: () => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).then(r => r.json()),
  getCategories: () => fetch('/api/categories', { credentials: 'include' }).then(async r => { const ct = r.headers.get('content-type') || ''; if (!ct.includes('application/json')) return []; const j = await r.json(); return Array.isArray(j) ? j : [] }),
  addCategory: (name) => fetch('/api/categories', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then(r => r.json()),
  getAccounts: (categoryId) => fetch(`/api/accounts?categoryId=${categoryId}`, { credentials: 'include' }).then(async r => { const ct = r.headers.get('content-type') || ''; if (!ct.includes('application/json')) return []; const j = await r.json(); return Array.isArray(j) ? j : [] }),
  addAccount: (categoryId, name) => fetch('/api/accounts', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId, name }) }).then(r => r.json()),
  startSession: (categoryId, accountId, hourlyRate) => fetch('/api/sessions/start', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId, accountId, hourlyRate }) }).then(r => r.json()),
  pauseSession: (sessionId) => fetch('/api/sessions/pause', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }).then(r => r.json()),
  resumeSession: (sessionId) => fetch('/api/sessions/resume', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }).then(r => r.json()),
  stopSession: (sessionId) => fetch('/api/sessions/stop', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }).then(r => r.json()),
  sessionStatus: (sessionId) => fetch(`/api/sessions/${sessionId}/status`, { credentials: 'include' }).then(r => r.json()),
  categoryRecommendation: (id) => fetch(`/api/categories/${id}/recommendation`, { credentials: 'include' }).then(r => r.json()),
  listSessions: ({ categoryId, accountId, status, scope }) => {
    const p = new URLSearchParams()
    if (categoryId) p.set('categoryId', categoryId)
    if (accountId) p.set('accountId', accountId)
    if (status) p.set('status', status)
    if (scope) p.set('scope', scope)
    return fetch(`/api/sessions?${p.toString()}`, { credentials: 'include' }).then(async r => {
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json')) throw new Error(await r.text())
      const j = await r.json(); if (!r.ok) throw new Error(j.error || '加载失败'); return j
    })
  },
  batchUpdateSessions: ({ ids, categoryId, accountId, scope }) => fetch('/api/sessions/batch/update', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, categoryId, accountId, scope }) }).then(async r => { const ct = r.headers.get('content-type') || ''; if (!ct.includes('application/json')) throw new Error(await r.text()); const j = await r.json(); if (!r.ok) throw new Error(j.error || '修改失败'); return j }),
  batchDeleteSessions: ({ ids, scope }) => fetch('/api/sessions/batch/delete', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, scope }) }).then(async r => { const ct = r.headers.get('content-type') || ''; if (!ct.includes('application/json')) throw new Error(await r.text()); const j = await r.json(); if (!r.ok) throw new Error(j.error || '删除失败'); return j })
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function App() {
  const [user, setUser] = useState(null)
  const [username, setUsername] = useState('')
  const [authError, setAuthError] = useState('')
  const [categories, setCategories] = useState([])
  const [categoryId, setCategoryId] = useState('')
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState('')
  const [hourlyRate, setHourlyRate] = useState('16.4')
  const [newCategory, setNewCategory] = useState('')
  const [newAccount, setNewAccount] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [status, setStatus] = useState(null)
  const [recommend, setRecommend] = useState({ averageMs: 0, averageAmount: 0 })
  const [report, setReport] = useState(null)
  const navChartRef = useRef(null)
  const navChartInstance = useRef(null)
  const granularity = 'day'
  const [dark, setDark] = useState(false)
  const [activeTab, setActiveTab] = useState('trend')
  const [exportFormat, setExportFormat] = useState('csv')
  const [scope, setScope] = useState('user')
  const [manageOpen, setManageOpen] = useState(false)
  const [manageSessions, setManageSessions] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [targetCategoryId, setTargetCategoryId] = useState('')
  const [targetAccounts, setTargetAccounts] = useState([])
  const [targetAccountId, setTargetAccountId] = useState('')
  const [manageMsg, setManageMsg] = useState('')
  const [manageLoading, setManageLoading] = useState(false)
  const [syncStatus, setSyncStatus] = useState({ enabled: false, intervalMs: 300000, lastSaveAt: 0, lastPullAt: 0, running: false, progress: '', logs: [] })
  const [intervalMs, setIntervalMs] = useState(300000)
  const [syncMsg, setSyncMsg] = useState('')
  const [health, setHealth] = useState({ configured: false, reachable: false, missing: [], lastError: '' })

  useEffect(() => { api.me().then(u => u && setUser(u)) }, [])
  useEffect(() => { if (user) fetch('/api/sync/status', { credentials: 'include' }).then(r => r.json()).then(s => { setSyncStatus(s); setIntervalMs(s.intervalMs || 300000) }) }, [user])
  useEffect(() => { if (user) fetch('/api/sync/health', { credentials: 'include' }).then(r => r.json()).then(setHealth) }, [user])
  useEffect(() => { if (user) api.getCategories().then(setCategories) }, [user])
  useEffect(() => { if (!targetCategoryId) { setTargetAccounts([]); setTargetAccountId(''); return } api.getAccounts(targetCategoryId).then(setTargetAccounts) }, [targetCategoryId])
  useEffect(() => {
    if (!categoryId) return
    api.getAccounts(categoryId).then(setAccounts)
    api.categoryRecommendation(categoryId).then(setRecommend)
    statsFetch()
  }, [categoryId])
  useEffect(() => {
    let t
    function tick() { if (!sessionId) return; api.sessionStatus(sessionId).then(s => setStatus(s)) }
    tick(); t = setInterval(tick, 1000); return () => clearInterval(t)
  }, [sessionId])

  function statsFetch() {
    const params = new URLSearchParams()
    if (categoryId) params.set('categoryId', categoryId)
    if (accountId) params.set('accountId', accountId)
    params.set('scope', scope)
    params.set('granularity', granularity)
    const fg = getComputedStyle(document.body).getPropertyValue('--fg').trim()
    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim()
    const border = getComputedStyle(document.body).getPropertyValue('--border').trim()
    if (activeTab === 'trend') {
      fetch(`/api/stats/series?${params}`).then(r => r.json()).then(series => {
        const labels = series.map(x => new Date(x.t).toLocaleDateString())
        const values = series.map(x => x.totalAmount)
        if (navChartInstance.current) navChartInstance.current.destroy()
        const ctx = navChartRef.current.getContext('2d')
        navChartInstance.current = new Chart(ctx, { type: 'line', data: { labels, datasets: [{ label: '趋势', data: values, borderColor: accent }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: fg } } }, scales: { x: { ticks: { color: fg } }, y: { beginAtZero: true, ticks: { color: fg }, grid: { color: border } } } } })
      })
    } else if (activeTab === 'distribution') {
      const params2 = new URLSearchParams(params); params2.set('field', 'total_amount'); params2.set('bins', '12')
      fetch(`/api/stats/distribution?${params2}`).then(r => r.json()).then(dist => {
        const labels = dist.bins.map(b => `${Math.round(b.from)}-${Math.round(b.to)}`)
        const values = dist.bins.map(b => b.count)
        if (navChartInstance.current) navChartInstance.current.destroy()
        const ctx = navChartRef.current.getContext('2d')
        navChartInstance.current = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: '直方图', data: values, backgroundColor: accent }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: fg } } }, scales: { x: { ticks: { color: fg } }, y: { beginAtZero: true, ticks: { color: fg }, grid: { color: border } } } } })
      })
    } else {
      const params3 = new URLSearchParams(params); params3.set('by', 'account')
      fetch(`/api/stats/pie?${params3}`).then(r => r.json()).then(p => {
        const labels = p.map(x => x.key)
        const values = p.map(x => x.value)
        if (navChartInstance.current) navChartInstance.current.destroy()
        const ctx = navChartRef.current.getContext('2d')
        navChartInstance.current = new Chart(ctx, { type: 'pie', data: { labels, datasets: [{ data: values, backgroundColor: labels.map(() => accent) }] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: 16 }, plugins: { legend: { position: 'bottom', labels: { color: fg } } } } })
      })
    }
  }

  useEffect(() => { if (!user) return; statsFetch() }, [user, categoryId, accountId, dark, activeTab, scope])

  const canStart = categoryId && accountId && hourlyRate && !sessionId
  const running = status && status.session?.status === 'running'
  const paused = status && status.session?.status === 'paused'

  if (!user) {
    return (
      <div className="container">
        <div className="card">
          <h2>登录/注册</h2>
          <div className="row">
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="用户名" />
            <button disabled={!username.trim()} onClick={() => api.login(username).then(u => { if (!u || u.error) { setAuthError((u && u.error) || '请求失败'); } else { setUser(u); setAuthError('') } })}>登录</button>
            <button disabled={!username.trim()} onClick={() => api.register(username).then(u => { if (!u || u.error) { setAuthError((u && u.error) || '请求失败'); } else { setUser(u); setAuthError('') } })}>注册</button>
          </div>
          {authError && <div style={{ color: 'crimson', marginTop: 8 }}>{authError}</div>}
        </div>
      </div>
    )
  }
  return (
    <div className="container">
      <div className="header">
        <h2>计时计费工具</h2>
        <div className="row">
          <span>当前用户：{user.username}</span>
          <button onClick={() => { setDark(!dark); document.body.classList.toggle('dark', !dark) }}>{dark ? '浅色模式' : '暗色模式'}</button>
          <button onClick={() => api.logout().then(() => { setUser(null); setCategories([]); setAccounts([]); setCategoryId(''); setAccountId(''); setSessionId(null) })}>退出</button>
        </div>
      </div>

      <div className="navbar">
        <div className="nav-group">
          <div className="tabs">
            <button className={`tab ${activeTab === 'trend' ? 'active' : ''}`} onClick={() => setActiveTab('trend')}>趋势分析</button>
            <button className={`tab ${activeTab === 'distribution' ? 'active' : ''}`} onClick={() => setActiveTab('distribution')}>数据分布</button>
            <button className={`tab ${activeTab === 'pie' ? 'active' : ''}`} onClick={() => setActiveTab('pie')}>占比统计</button>
          </div>
          <div className="navChartWrap"><canvas ref={navChartRef}></canvas></div>
        </div>
        <div className="divider"></div>
        <div className="nav-group">
          <div className="ops-actions">
            <label>
              <span>统计范围</span>
              <select className="select" value={scope} onChange={e => setScope(e.target.value)}>
                <option value="user">用户</option>
                {user.username === 'xiach' && <option value="global">全部</option>}
              </select>
            </label>
            <button onClick={() => {
              const next = !manageOpen
              setManageOpen(next)
              setManageMsg('')
              if (next) {
                setManageLoading(true)
                api.listSessions({ categoryId, accountId, status: 'stopped', scope }).then(setManageSessions).catch(e => setManageMsg(String(e.message || e))).finally(() => setManageLoading(false))
              }
            }}>{manageOpen ? '关闭数据管理' : '数据管理'}</button>

            <select className="select" value={exportFormat} onChange={e => setExportFormat(e.target.value)}>
              <option value="csv">CSV</option>
              <option value="xlsx">Excel</option>
              <option value="json">JSON</option>
            </select>
            <button onClick={() => {
              const params = new URLSearchParams()
              if (categoryId) params.set('categoryId', categoryId)
              if (accountId) params.set('accountId', accountId)
              params.set('scope', scope)
              params.set('format', exportFormat)
              if (exportFormat === 'csv') {
                fetch(`/api/export?${params}`).then(r => r.text()).then(txt => { const blob = new Blob([txt], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'export.csv'; a.click() })
              } else if (exportFormat === 'xlsx') {
                fetch(`/api/export?${params}`).then(r => r.arrayBuffer()).then(buf => { const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'export.xlsx'; a.click() })
              } else {
                fetch(`/api/export?${params}`).then(r => r.blob()).then(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'export.json'; a.click() })
              }
            }}>导出</button>
            <button onClick={() => {
              const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'; input.onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { const records = JSON.parse(t); fetch('/api/import', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records, onDuplicate: 'merge' }) }).then(r => r.json()).then(() => statsFetch()) }) }; input.click()
            }}>导入</button>
            
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8, display: 'grid', gap: 8 }}>
              <div className="row">
                <label>
                  <span>自动存储</span>
                  <select className="select" value={syncStatus.enabled ? 'on' : 'off'} onChange={e => {
                    const en = e.target.value === 'on'
                    fetch('/api/sync/config', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: en, intervalMs }) })
                      .then(r => r.json()).then(s => { setSyncStatus(s); setSyncMsg('已更新自动存储') })
                  }}>
                    <option value="off">关闭</option>
                    <option value="on">开启</option>
                  </select>
                </label>
                <label>
                  <span>时间间隔(ms)</span>
                  <input type="number" value={intervalMs} onChange={e => setIntervalMs(Number(e.target.value))} />
                  <button onClick={() => {
                    fetch('/api/sync/config', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: syncStatus.enabled, intervalMs }) })
                      .then(r => r.json()).then(s => { setSyncStatus(s); setSyncMsg('已更新间隔') })
                  }}>保存配置</button>
                </label>
                <button onClick={() => {
                  if (!confirm('确认立即保存到云端？')) return
                  setSyncMsg('')
                  fetch('/api/sync/save', { method: 'POST', credentials: 'include' })
                    .then(r => r.json()).then(s => { setSyncStatus(s); setSyncMsg('已保存到云端') })
                    .catch(e => setSyncMsg(String(e.message || e)))
                }}>立即存储</button>
                <button onClick={() => {
                  setSyncMsg('')
                  fetch('/api/sync/pull', { method: 'POST', credentials: 'include' })
                    .then(r => r.json()).then(s => { setSyncStatus(s); setSyncMsg('已从云端拉取并合并'); statsFetch() })
                    .catch(e => setSyncMsg(String(e.message || e)))
                }}>立即同步</button>
              </div>
              <div style={{ fontSize: 12, color: 'gray' }}>
                <div>状态：{syncStatus.running ? '进行中' : '空闲'} {syncStatus.progress || ''}</div>
                <div>上次保存：{syncStatus.lastSaveAt ? new Date(syncStatus.lastSaveAt).toLocaleString() : '-'}</div>
                <div>上次拉取：{syncStatus.lastPullAt ? new Date(syncStatus.lastPullAt).toLocaleString() : '-'}</div>
                {syncMsg && <div style={{ color: 'teal' }}>{syncMsg}</div>}
              </div>
              <div style={{ maxHeight: 120, overflow: 'auto', border: '1px dashed var(--border)', borderRadius: 6, padding: 6 }}>
                {(syncStatus.logs || []).slice().reverse().map((l, i) => (
                  <div key={i} style={{ fontSize: 12 }}>{new Date(l.t).toLocaleString()} {l.msg}</div>
                ))}
              </div>
              <div style={{ borderTop: '1px dashed var(--border)', marginTop: 8, paddingTop: 8, fontSize: 12 }}>
                <div>云端配置：{health.configured ? '已配置' : '未配置'}</div>
                <div>连接：{health.reachable ? '正常' : '失败'}</div>
                {health.missing && health.missing.length > 0 && <div>缺少表：{health.missing.join(', ')}</div>}
                {health.lastError && <div style={{ color: 'crimson' }}>{health.lastError}</div>}
              </div>
            </div>
          </div>
          {manageOpen && (
            <div style={{ marginTop: 8 }}>
              <div className="row">
                <button onClick={() => { setManageLoading(true); api.listSessions({ categoryId, accountId, status: 'stopped', scope }).then(setManageSessions).then(() => { setSelectedIds([]); setManageMsg('') }).catch(e => setManageMsg(String(e.message || e))).finally(() => setManageLoading(false)) }}>加载数据</button>
                <button onClick={() => { const all = manageSessions.map(s => s.id); setSelectedIds(all) }}>全选</button>
                <button onClick={() => setSelectedIds([])}>清空选择</button>
              </div>
              <div className="row">
                <label>
                  <span>目标分类</span>
                  <select className="select" value={targetCategoryId} onChange={e => setTargetCategoryId(e.target.value)}>
                    <option value="">请选择</option>
                    {(Array.isArray(categories) ? categories : []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>目标账号</span>
                  <select className="select" value={targetAccountId} onChange={e => setTargetAccountId(e.target.value)}>
                    <option value="">请选择</option>
                    {(Array.isArray(targetAccounts) ? targetAccounts : []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
                <button disabled={!selectedIds.length || (!targetCategoryId && !targetAccountId)} onClick={() => {
                  setManageLoading(true)
                  api.batchUpdateSessions({ ids: selectedIds, categoryId: targetCategoryId || undefined, accountId: targetAccountId || undefined, scope })
                    .then(r => { setManageMsg(`已修改 ${r.updated || 0} 条`) })
                    .then(() => api.listSessions({ categoryId, accountId, status: 'stopped', scope }).then(setManageSessions))
                    .then(() => statsFetch())
                    .catch(e => setManageMsg(String(e.message || e)))
                    .finally(() => setManageLoading(false))
                }}>批量修改</button>
                <button disabled={!selectedIds.length} onClick={() => {
                  setManageLoading(true)
                  api.batchDeleteSessions({ ids: selectedIds, scope })
                    .then(r => { setManageMsg(`已删除 ${r.deleted || 0} 条`) })
                    .then(() => api.listSessions({ categoryId, accountId, status: 'stopped', scope }).then(setManageSessions))
                    .then(() => statsFetch())
                    .catch(e => setManageMsg(String(e.message || e)))
                    .finally(() => setManageLoading(false))
                }}>批量删除</button>
                {manageLoading && <span>处理中...</span>}
                {manageMsg && <span>{manageMsg}</span>}
              </div>
              <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 6 }}>
                {manageSessions.map(s => (
                  <label key={s.id} style={{ display: 'grid', gridTemplateColumns: '18px 1fr auto', alignItems: 'center', columnGap: 6, padding: '2px 0', fontSize: 12, lineHeight: 1.2 }}>
                    <input type="checkbox" checked={selectedIds.includes(s.id)} onChange={e => { if (e.target.checked) setSelectedIds([...selectedIds, s.id]); else setSelectedIds(selectedIds.filter(x => x !== s.id)) }} />
                    <span>{new Date(s.start_time).toLocaleString()} - {s.end_time ? new Date(s.end_time).toLocaleString() : ''}</span>
                    <span style={{ textAlign: 'right' }}>¥{(s.total_amount || 0).toFixed(2)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>分类与账号</h2>
        <div className="row">
          <label>
            <span>选择分类</span>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">请选择</option>
              {(Array.isArray(categories) ? categories : []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>
            <span>新建分类</span>
            <div className="row">
              <input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="分类名" />
              <button onClick={() => newCategory && api.addCategory(newCategory).then(() => { setNewCategory(''); api.getCategories().then(setCategories) })}>创建</button>
            </div>
          </label>
        </div>
        <div className="row">
          <label>
            <span>选择账号</span>
            <select value={accountId} onChange={e => setAccountId(e.target.value)}>
              <option value="">请选择</option>
              {(Array.isArray(accounts) ? accounts : []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>
            <span>新建账号</span>
            <div className="row">
              <input value={newAccount} onChange={e => setNewAccount(e.target.value)} placeholder="账号名" />
              <button onClick={() => categoryId && newAccount && api.addAccount(Number(categoryId), newAccount).then(() => { setNewAccount(''); api.getAccounts(categoryId).then(setAccounts) })}>创建</button>
            </div>
          </label>
          <label>
            <span>时薪</span>
            <input type="number" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>计时控制</h2>
        <div className="row controls">
          <button disabled={!canStart} onClick={() => api.startSession(Number(categoryId), Number(accountId), Number(hourlyRate)).then(r => setSessionId(r.id))}>开始</button>
          <button disabled={!running} onClick={() => api.pauseSession(sessionId).then(() => api.sessionStatus(sessionId).then(setStatus))}>暂停</button>
          <button disabled={!paused} onClick={() => api.resumeSession(sessionId).then(() => api.sessionStatus(sessionId).then(setStatus))}>继续</button>
          <button disabled={!sessionId} onClick={() => api.stopSession(sessionId)
            .then(() => api.sessionStatus(sessionId))
            .then(s => {
              setStatus(s); setSessionId(null); api.categoryRecommendation(categoryId).then(setRecommend); statsFetch()
              try {
                const sess = s.session || {}
                const catName = (categories.find(c => c.id === sess.category_id)?.name) || String(sess.category_id || categoryId || '')
                const accName = (accounts.find(a => a.id === sess.account_id)?.name) || String(sess.account_id || accountId || '')
                const start = sess.start_time ? new Date(sess.start_time).toLocaleString() : '-'
                const end = sess.end_time ? new Date(sess.end_time).toLocaleString() : '-'
                const totalMs = sess.total_ms ?? s.totalMs ?? 0
                const total = formatMs(totalMs)
                const amount = (sess.total_amount ?? ((totalMs / 3600000) * (sess.hourly_rate || Number(hourlyRate) || 0))).toFixed(2)
                const segs = Array.isArray(sess.segments) ? sess.segments : []
                const lines = segs.map((seg, i) => {
                  const st = seg.start_time ? new Date(seg.start_time).toLocaleString() : '-'
                  const ed = seg.end_time ? new Date(seg.end_time).toLocaleString() : '-'
                  const dur = formatMs(Math.max(0, (seg.end_time || 0) - (seg.start_time || 0)))
                  return `#${i + 1} ${st} - ${ed}  (${dur})`
                })
                const text = `分类：${catName}\n账号：${accName}\n开始：${start}\n结束：${end}\n耗时：${total}\n费用：¥${amount}\n分段：${segs.length}${segs.length ? `\n${lines.join('\n')}` : ''}`
                setReport({ text })
              } catch {}
            })}>结束</button>
        </div>
        <div className="metrics">
          <div>当前时间：{formatMs(status?.totalMs || 0)}</div>
          <div>累计费用：¥{(status?.estimatedAmount || 0).toFixed(2)}</div>
          <div>历史均值：时间 {formatMs(recommend.averageMs || 0)}，总价 ¥{(recommend.averageAmount || 0).toFixed(2)}</div>
        </div>
        {report && (
          <div className="card report">
            <h2>结束汇报</h2>
            <pre>{report.text}</pre>
            <div className="row">
              <button onClick={() => { navigator.clipboard && navigator.clipboard.writeText(report.text) }}>复制到剪贴板</button>
              <button onClick={() => setReport(null)}>关闭</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const style = document.createElement('style');
style.textContent = `:root{--bg:#fff;--fg:#222;--border:#ddd;--accent:#1976d2}.dark{--bg:#1F1F1F;--fg:#f0f0f0;--border:#333;--accent:#0096FA}body{background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;padding:16px}.container{max-width:1100px;margin:0 auto;display:grid;gap:16px}.card{border:1px solid var(--border);border-radius:8px;padding:16px;background:transparent}.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}label{display:flex;flex-direction:column;gap:4px}input,select,button{padding:8px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:6px}button{background:var(--accent);color:#fff;border:none}.controls button{min-width:96px}.metrics{font-size:18px}.report{border:1px dashed var(--border)}.report pre{white-space:pre-wrap;word-wrap:break-word;font-size:14px;line-height:1.5}.header{display:flex;justify-content:space-between;align-items:center}.navbar{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;border:1px solid var(--border);border-radius:8px;padding:12px}.nav-group{display:flex;flex-direction:column;gap:8px;flex:1;min-width:280px}.tabs{display:flex;gap:8px;flex-wrap:wrap}.tab{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid var(--border);border-radius:20px;background:var(--bg);color:var(--fg);cursor:pointer}.tab.active{background:var(--accent);color:#fff;border-color:var(--accent)}.divider{width:1px;background:var(--border);align-self:stretch}.ops-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:flex-start}.select{padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg)}.navChartWrap{width:100%;height:240px}.navChartWrap canvas{width:100%!important;height:100%!important}@media (max-width:600px){.row{flex-direction:column;align-items:stretch}}`;
document.head.appendChild(style)

createRoot(document.getElementById('root')).render(<App />)