/**
 * 密安密码本 - 纯前端 PWA 实现
 * 使用 Web Crypto API + IndexedDB，无服务端。
 */

(() => {
  'use strict'

  // ===== IndexedDB 封装 =====
  const DB_NAME = 'mian_password_manager'
  const DB_VERSION = 1
  const VAULT_STORE = 'vault'
  const ENTRIES_STORE = 'entries'
  const CATEGORIES_STORE = 'categories'

  let dbPromise = null
  let masterKeyCache = null
  let dbKeyCache = null


  function openDB() {
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains(VAULT_STORE)) db.createObjectStore(VAULT_STORE)
        if (!db.objectStoreNames.contains(ENTRIES_STORE)) db.createObjectStore(ENTRIES_STORE, { keyPath: 'id', autoIncrement: true })
        if (!db.objectStoreNames.contains(CATEGORIES_STORE)) {
          const store = db.createObjectStore(CATEGORIES_STORE, { keyPath: 'id', autoIncrement: true })
          store.put({ name: '社交', color: '#4cc9f0', sortOrder: 0 })
          store.put({ name: '金融', color: '#f72585', sortOrder: 1 })
          store.put({ name: '工作', color: '#7209b7', sortOrder: 2 })
          store.put({ name: '购物', color: '#4895ef', sortOrder: 3 })
          store.put({ name: '其他', color: '#6c757d', sortOrder: 4 })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return dbPromise
  }

  async function tx(storeName, mode) {
    const db = await openDB()
    return db.transaction(storeName, mode).objectStore(storeName)
  }

  async function dbGet(storeName, key) {
    return new Promise(async (resolve, reject) => {
      const store = await tx(storeName, 'readonly')
      const req = store.get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async function dbPut(storeName, value, key) {
    return new Promise(async (resolve, reject) => {
      const store = await tx(storeName, 'readwrite')
      const req = key === undefined ? store.put(value) : store.put(value, key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async function dbGetAll(storeName) {
    return new Promise(async (resolve, reject) => {
      const store = await tx(storeName, 'readonly')
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async function dbDelete(storeName, key) {
    return new Promise(async (resolve, reject) => {
      const store = await tx(storeName, 'readwrite')
      const req = store.delete(key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  }

  // ===== 加密工具 =====
  const KDF_ITERATIONS = 600000
  const SALT_LENGTH = 16
  const KEY_LENGTH = 32
  const IV_LENGTH = 12
  const TAG_LENGTH = 16
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  function bufToBase64(buf) {
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }

  function base64ToBuf(base64) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  function concatBuffers(parts) {
    const total = parts.reduce((s, p) => s + p.length, 0)
    const r = new Uint8Array(total)
    let o = 0
    for (const p of parts) { r.set(p, o); o += p.length }
    return r
  }

  async function sha256(data) {
    const buf = typeof data === 'string' ? encoder.encode(data) : data
    const hash = await crypto.subtle.digest('SHA-256', buf)
    return bufToBase64(hash)
  }

  async function deriveMasterKey(password, salt) {
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
    return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' }, keyMaterial, KEY_LENGTH * 8)
  }

  async function hkdfExpand(key, label) {
    const keyBuf = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signed = await crypto.subtle.sign('HMAC', keyBuf, encoder.encode(label))
    return signed.slice(0, KEY_LENGTH)
  }

  async function aesGcmEncrypt(plaintext, key) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt'])
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoder.encode(plaintext))
    const full = new Uint8Array(encrypted)
    return {
      ciphertext: bufToBase64(full.slice(0, full.length - TAG_LENGTH)),
      nonce: bufToBase64(iv),
      tag: bufToBase64(full.slice(full.length - TAG_LENGTH))
    }
  }

  async function aesGcmDecrypt(ciphertextB64, nonceB64, tagB64, key) {
    const full = concatBuffers([base64ToBuf(ciphertextB64), base64ToBuf(tagB64)])
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt'])
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBuf(nonceB64) }, cryptoKey, full)
    return decoder.decode(decrypted)
  }


  // ===== 登录锁定状态（本地防暴力破解）=====
  const LOCK_KEY = 'mian_lock_state'
  const LOCK_LEVELS = [
    { threshold: 5, duration: 30 * 1000, label: '30 秒' },     // 第一次锁定
    { threshold: 10, duration: 5 * 60 * 1000, label: '5 分钟' }, // 第二次锁定
    { threshold: 15, duration: Infinity, label: '永久' }       // 第三次锁定，必须清数据
  ]

  function loadLockState() {
    try {
      return JSON.parse(localStorage.getItem(LOCK_KEY)) || { failedAttempts: 0, lastLockTime: 0 }
    } catch {
      return { failedAttempts: 0, lastLockTime: 0 }
    }
  }

  function saveLockState(state) {
    localStorage.setItem(LOCK_KEY, JSON.stringify(state))
  }

  function getCurrentLock() {
    const state = loadLockState()
    for (let i = LOCK_LEVELS.length - 1; i >= 0; i--) {
      if (state.failedAttempts >= LOCK_LEVELS[i].threshold) {
        const level = LOCK_LEVELS[i]
        if (level.duration === Infinity) return { locked: true, permanent: true, level, remaining: Infinity, state }
        const elapsed = Date.now() - state.lastLockTime
        if (elapsed < level.duration) {
          return { locked: true, permanent: false, level, remaining: level.duration - elapsed, state }
        }
        // 过了锁定时间，但未成功登录前不重置失败次数
        return { locked: false, permanent: false, level: null, remaining: 0, state }
      }
    }
    return { locked: false, permanent: false, level: null, remaining: 0, state }
  }

  function recordFailedAttempt() {
    const state = loadLockState()
    state.failedAttempts++
    state.lastLockTime = Date.now()
    saveLockState(state)
    return getCurrentLock()
  }

  function clearLockState() {
    saveLockState({ failedAttempts: 0, lastLockTime: 0 })
  }

  function formatMs(ms) {
    if (ms <= 0) return '0 秒'
    const sec = Math.ceil(ms / 1000)
    if (sec < 60) return `${sec} 秒`
    const min = Math.floor(sec / 60)
    const s = sec % 60
    return s ? `${min} 分 ${s} 秒` : `${min} 分`
  }

  async function isVaultSetup() {
    return !!(await dbGet(VAULT_STORE, 'config'))
  }

  async function setupVault(password, hint) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
    const masterKey = new Uint8Array(await deriveMasterKey(password, salt))
    const verifierKey = new Uint8Array(await hkdfExpand(masterKey, 'verifier'))
    const verifier = await sha256(verifierKey)
    await dbPut(VAULT_STORE, { salt: bufToBase64(salt), verifier, hint, createdAt: Date.now() }, 'config')
    clearLockState()
    masterKeyCache = masterKey
    dbKeyCache = new Uint8Array(await hkdfExpand(masterKey, 'database'))
  }

  async function unlockVault(password) {
    const lock = getCurrentLock()
    if (lock.locked) {
      if (lock.permanent) {
        throw new Error('已连续输错 15 次，保险库已被永久锁定。请重置保险库后重新使用。')
      }
      throw new Error(`密码输错次数过多，请 ${formatMs(lock.remaining)} 后再试`)
    }
    const config = await dbGet(VAULT_STORE, 'config')
    if (!config) throw new Error('保险库尚未初始化')
    const masterKey = new Uint8Array(await deriveMasterKey(password, base64ToBuf(config.salt)))
    const verifierKey = new Uint8Array(await hkdfExpand(masterKey, 'verifier'))
    const verifier = await sha256(verifierKey)
    if (verifier !== config.verifier) {
      const after = recordFailedAttempt()
      if (after.locked) {
        if (after.permanent) throw new Error('已连续输错 15 次，保险库已被永久锁定。请重置保险库后重新使用。')
        throw new Error(`密码错误，已连续输错 ${after.state.failedAttempts} 次。请 ${formatMs(after.remaining)} 后再试`)
      }
      throw new Error(`主密码错误（已连续输错 ${after.state.failedAttempts} 次）`)
    }
    clearLockState()
    masterKeyCache = masterKey
    dbKeyCache = new Uint8Array(await hkdfExpand(masterKey, 'database'))
  }

  function lockVault() {
    masterKeyCache = null
    dbKeyCache = null
  }

  function ensureUnlocked() {
    if (!dbKeyCache) throw new Error('保险库未解锁')
    return dbKeyCache
  }

  async function changeMasterPassword(oldPassword, newPassword) {
    await unlockVault(oldPassword)
    const oldDbKey = ensureUnlocked()
    const entries = await dbGetAll(ENTRIES_STORE)
    const plaintexts = []
    for (const entry of entries) {
      const payload = await aesGcmDecrypt(entry.encryptedPayload, entry.nonce, entry.tag, oldDbKey)
      plaintexts.push({ entry, payload: JSON.parse(payload) })
    }
    await setupVault(newPassword)
    const newDbKey = ensureUnlocked()
    for (const { entry, payload } of plaintexts) {
      const enc = await aesGcmEncrypt(JSON.stringify(payload), newDbKey)
      entry.encryptedPayload = enc.ciphertext
      entry.nonce = enc.nonce
      entry.tag = enc.tag
      await dbPut(ENTRIES_STORE, entry)
    }
  }

  async function resetVault() {
    const entries = await dbGetAll(ENTRIES_STORE)
    for (const e of entries) await dbDelete(ENTRIES_STORE, e.id)
    await dbDelete(VAULT_STORE, 'config')
    lockVault()
  }

  async function getAllEntries() {
    ensureUnlocked()
    const entries = await dbGetAll(ENTRIES_STORE)
    return entries.filter(e => !e.deleted).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async function getDecryptedEntry(id) {
    const dbKey = ensureUnlocked()
    const entry = await dbGet(ENTRIES_STORE, id)
    if (!entry) return null
    const payload = await aesGcmDecrypt(entry.encryptedPayload, entry.nonce, entry.tag, dbKey)
    return { ...entry, payload: JSON.parse(payload) }
  }

  async function addEntry(payload, meta) {
    const dbKey = ensureUnlocked()
    const enc = await aesGcmEncrypt(JSON.stringify(payload), dbKey)
    const now = Date.now()
    return dbPut(ENTRIES_STORE, {
      encryptedPayload: enc.ciphertext,
      nonce: enc.nonce,
      tag: enc.tag,
      uuid: crypto.randomUUID(),
      ...meta,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      version: 1
    })
  }


  async function updateEntry(id, payload, meta) {
    const dbKey = ensureUnlocked()
    const existing = await dbGet(ENTRIES_STORE, id)
    if (!existing) throw new Error('记录不存在')
    const enc = await aesGcmEncrypt(JSON.stringify(payload), dbKey)
    return dbPut(ENTRIES_STORE, {
      ...existing,
      encryptedPayload: enc.ciphertext,
      nonce: enc.nonce,
      tag: enc.tag,
      ...meta,
      id,
      updatedAt: Date.now(),
      version: (existing.version || 0) + 1
    })
  }


  async function deleteEntry(id) {
    const entry = await dbGet(ENTRIES_STORE, id)
    if (!entry) return
    entry.deleted = true
    entry.updatedAt = Date.now()
    entry.version = (entry.version || 0) + 1
    await dbPut(ENTRIES_STORE, entry)
  }

  async function getCategories() {
    return (await dbGetAll(CATEGORIES_STORE)).sort((a, b) => a.sortOrder - b.sortOrder)
  }

  // ===== 密码生成器 =====
  const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const LOWER = 'abcdefghijklmnopqrstuvwxyz'
  const DIGITS = '0123456789'
  const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?'
  const AMBIGUOUS = '0O1lI'
  const WORD_LIST = ['apple','river','mountain','blue','silent','quick','brave','clever','sunny','forest','ocean','whale','eagle','tiger','moon','star','cloud','storm','flame','winter','summer','spring','autumn','night','dream','spark','magic','crystal','shadow','thunder','coral','maple']

  function randomChar(charset) {
    return charset[crypto.getRandomValues(new Uint8Array(1))[0] % charset.length]
  }

  function shuffle(str) {
    const arr = str.split('')
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(crypto.getRandomValues(new Uint8Array(1))[0] / 256 * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr.join('')
  }

  function generatePassword(options) {
    const mode = options.mode || 'random'
    const length = options.length || 16
    if (mode === 'pin') return Array.from({ length }, () => randomChar(DIGITS)).join('')
    if (mode === 'memorable') {
      const words = options.words || 4
      const sep = options.separator || '-'
      return Array.from({ length: words }, () => WORD_LIST[crypto.getRandomValues(new Uint8Array(1))[0] % WORD_LIST.length]).join(sep)
    }
    let charset = ''
    if (options.includeLower !== false) charset += LOWER
    if (options.includeUpper) charset += UPPER
    if (options.includeDigits) charset += DIGITS
    if (options.includeSymbols) charset += SYMBOLS
    if (!charset) charset = LOWER + UPPER + DIGITS
    if (options.excludeAmbiguous) charset = charset.split('').filter(c => !AMBIGUOUS.includes(c)).join('')
    const required = []
    if (options.includeLower !== false) required.push(randomChar(LOWER))
    if (options.includeUpper) required.push(randomChar(UPPER))
    if (options.includeDigits) required.push(randomChar(DIGITS))
    if (options.includeSymbols) required.push(randomChar(SYMBOLS))
    let pwd = ''
    for (let i = 0; i < Math.max(0, length - required.length); i++) pwd += randomChar(charset)
    return shuffle(pwd + required.join(''))
  }

  function estimateStrength(password) {
    let score = 0
    if (password.length >= 12) score++
    if (password.length >= 16) score++
    if (/[a-z]/.test(password)) score++
    if (/[A-Z]/.test(password)) score++
    if (/\d/.test(password)) score++
    if (/[^a-zA-Z0-9]/.test(password)) score++
    if (score <= 2) return { label: '弱', color: '#f72585' }
    if (score <= 4) return { label: '中', color: '#f9c74f' }
    if (score <= 5) return { label: '强', color: '#4cc9f0' }
    return { label: '极强', color: '#2ecc71' }
  }

  // ===== UI 工具 =====
  const app = document.getElementById('app')
  const toastEl = document.getElementById('toast')
  let currentScreen = 'unlock'
  let editingId = null
  let entriesCache = []
  let decryptedCache = {}
  let categoriesCache = []

  function showToast(msg) {
    toastEl.textContent = msg
    toastEl.classList.add('show')
    setTimeout(() => toastEl.classList.remove('show'), 2000)
  }

  function html(str) {
    const div = document.createElement('div')
    div.innerHTML = str.trim()
    return div.firstChild
  }

  function navigate(screen) {
    currentScreen = screen
    render()
  }

  function getCategory(id) {
    return categoriesCache.find(c => c.id === id)
  }

  function getInitials(name) {
    return (name || '?').slice(0, 2).toUpperCase()
  }

  async function copyToClipboard(text) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制')
    } catch {
      showToast('复制失败')
    }
  }

  // ===== 解锁页 =====
  function renderUnlock() {
    const lock = getCurrentLock()
    const isLocked = lock.locked && !lock.permanent
    const isPermanent = lock.permanent
    let lockMessage = ''
    if (isPermanent) {
      lockMessage = `已连续输错 ${lock.state.failedAttempts} 次，保险库已被永久锁定。请重置后重新使用。`
    } else if (isLocked) {
      lockMessage = `密码输错次数过多，请 ${formatMs(lock.remaining)} 后再试`
    } else if (lock.state.failedAttempts > 0) {
      lockMessage = `已连续输错 ${lock.state.failedAttempts} 次，注意锁定保护。`
    }

    app.innerHTML = `
      <div class="unlock-screen">
        <img src="icon.svg" class="unlock-logo" alt="logo" />
        <h1 class="unlock-title">密安密码本</h1>
        <p class="unlock-subtitle">${initialized ? '输入主密码解锁保险库' : '创建你的主密码'}</p>
        ${lockMessage ? `<div class="lock-banner ${isPermanent ? 'lock-permanent' : ''}" id="lockBanner">${lockMessage}</div>` : ''}
        <form id="unlockForm" class="unlock-form">
          <div class="password-field">
            <input type="password" id="password" class="input-field" placeholder="主密码" required ${isLocked || isPermanent ? 'disabled' : ''} />
            <div class="password-actions">
              <button type="button" class="small-btn" id="togglePw">显示</button>
            </div>
          </div>
          ${!initialized ? `
            <div class="password-field">
              <input type="password" id="confirmPassword" class="input-field" placeholder="确认主密码" required />
            </div>
            <div class="strength-bar"><div class="strength-fill" id="strengthFill" style="width:0%"></div></div>
            <input type="text" id="hint" class="input-field" placeholder="密码提示（可选）" />
            <p class="hint-text">主密码用于加密所有数据，遗忘后无法恢复，请妥善保管。</p>
          ` : ''}
          <p class="error-text" id="unlockError"></p>
          <button type="submit" class="btn btn-primary btn-block" ${isLocked || isPermanent ? 'disabled' : ''}>${initialized ? '解锁' : '创建保险库'}</button>
          ${isPermanent ? `<button type="button" class="btn btn-danger btn-block" id="btnLockedReset" style="margin-top:12px">重置保险库</button>` : ''}
        </form>
      </div>
    `
    const form = document.getElementById('unlockForm')
    const pwInput = document.getElementById('password')
    const toggleBtn = document.getElementById('togglePw')
    const errorEl = document.getElementById('unlockError')

    if (isLocked) {
      const banner = document.getElementById('lockBanner')
      const interval = setInterval(() => {
        const now = getCurrentLock()
        if (!now.locked || now.permanent) {
          clearInterval(interval)
          renderUnlock()
          return
        }
        banner.textContent = `密码输错次数过多，请 ${formatMs(now.remaining)} 后再试`
      }, 1000)
    }

    if (isPermanent) {
      document.getElementById('btnLockedReset').addEventListener('click', async () => {
        if (!confirm('重置保险库将删除所有本地密码记录和主密码，且无法恢复。确定继续吗？')) return
        await resetVault()
        initialized = false
        navigate('unlock')
        showToast('保险库已重置')
      })
    }

    toggleBtn.addEventListener('click', () => {
      pwInput.type = pwInput.type === 'password' ? 'text' : 'password'
      toggleBtn.textContent = pwInput.type === 'password' ? '显示' : '隐藏'
    })

    if (!initialized) {
      const confirmInput = document.getElementById('confirmPassword')
      const strengthFill = document.getElementById('strengthFill')
      pwInput.addEventListener('input', () => {
        const s = estimateStrength(pwInput.value)
        strengthFill.style.width = Math.min(100, pwInput.value.length * 6 + 10) + '%'
        strengthFill.style.background = s.color
      })
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      errorEl.textContent = ''
      const password = pwInput.value
      try {
        if (!initialized) {
          const confirm = document.getElementById('confirmPassword').value
          const hint = document.getElementById('hint').value
          if (password.length < 8) { errorEl.textContent = '主密码长度至少 8 位'; return }
          if (password !== confirm) { errorEl.textContent = '两次输入不一致'; return }
          await setupVault(password, hint)
          initialized = true
          showToast('保险库已创建')
        } else {
          await unlockVault(password)
          showToast('解锁成功')
        }
        await loadHomeData()
        navigate('home')
      } catch (err) {
        errorEl.textContent = err.message || '操作失败'
      }
    })
  }

  // ===== 首页 =====
  async function loadHomeData() {
    categoriesCache = await getCategories()
    entriesCache = await getAllEntries()
    // 修复旧版本中错用 ciphertext 字段的数据
    for (const entry of entriesCache) {
      if (entry.ciphertext && !entry.encryptedPayload) {
        entry.encryptedPayload = entry.ciphertext
        delete entry.ciphertext
        await dbPut(ENTRIES_STORE, entry)
      }
    }
    decryptedCache = {}
    for (const entry of entriesCache) {
      try {
        const d = await getDecryptedEntry(entry.id)
        if (d) decryptedCache[entry.id] = d.payload
      } catch (e) { console.error('解密失败', e) }
    }
  }


  function renderHome(filter = '') {
    app.innerHTML = `
      <div class="main-screen">
        <div class="header">
          <span class="header-title">密安密码本</span>
          <div class="header-actions">
            <button class="icon-btn" id="btnGenerator" title="生成器">⚡</button>
            <button class="icon-btn" id="btnSettings" title="设置">⚙</button>
            <button class="icon-btn" id="btnLock" title="锁定">🔒</button>
          </div>
        </div>
        <div class="search-bar">
          <input type="text" id="searchInput" class="search-input" placeholder="搜索平台、用户名、备注..." value="${filter}" />
        </div>
        <div class="content" id="homeContent"></div>
        <button class="fab" id="btnAdd">+</button>
      </div>
    `

    const content = document.getElementById('homeContent')
    const renderList = (q) => {
      const filtered = q ? entriesCache.filter(e => {
        const p = decryptedCache[e.id]
        if (!p) return false
        return (p.platform + p.username + p.url + p.note).toLowerCase().includes(q.toLowerCase())
      }) : entriesCache

      if (filtered.length === 0) {
        content.innerHTML = `<div class="empty-state"><p>${q ? '未找到匹配记录' : '还没有保存密码，点击下方 + 添加'}</p></div>`
      } else {
        content.innerHTML = `<div class="entry-list">${filtered.map(entry => {
          const p = decryptedCache[entry.id]
          const cat = getCategory(entry.categoryId)
          return `
            <div class="entry-card" data-id="${entry.id}">
              <div class="entry-icon" style="background:${cat?.color || '#4cc9f0'};color:#fff">${getInitials(p?.platform)}</div>
              <div class="entry-info">
                <div class="entry-name">${p?.platform || '未命名'}</div>
                <div class="entry-meta">${p?.username || cat?.name || '未分类'}</div>
              </div>
              <span>›</span>
            </div>
          `
        }).join('')}</div>`
      }
      document.querySelectorAll('.entry-card').forEach(card => {
        card.addEventListener('click', () => renderDetail(Number(card.dataset.id)))
      })
    }

    renderList(filter)

    document.getElementById('searchInput').addEventListener('input', (e) => renderList(e.target.value))
    document.getElementById('btnAdd').addEventListener('click', () => { editingId = null; navigate('form') })
    document.getElementById('btnGenerator').addEventListener('click', () => navigate('generator'))
    document.getElementById('btnSettings').addEventListener('click', () => navigate('settings'))
    document.getElementById('btnLock').addEventListener('click', () => { lockVault(); navigate('unlock') })
  }


  // ===== 详情页 =====
  async function renderDetail(id) {
    const detail = await getDecryptedEntry(id)
    if (!detail) return renderHome()
    const p = detail.payload
    const cat = getCategory(detail.categoryId)
    let showPassword = false

    app.innerHTML = `
      <div class="detail-screen">
        <div class="form-header">
          <button class="icon-btn" id="btnBack">←</button>
          <span class="form-title">密码详情</span>
          <button class="icon-btn" id="btnEditDetail">✎</button>
        </div>
        <div class="detail-body">
          <div class="detail-section" style="text-align:center">
            <div class="entry-icon" style="margin:0 auto 12px;background:${cat?.color || '#4cc9f0'};color:#fff;width:64px;height:64px;font-size:28px">${getInitials(p.platform)}</div>
            <h2 style="margin-bottom:4px">${p.platform}</h2>
            <p style="color:var(--text-muted)">${cat?.name || '未分类'}</p>
          </div>
          <div class="detail-section">
            <div class="detail-label">用户名 / 邮箱</div>
            <div class="detail-value">${p.username || '-'}</div>
          </div>
          <div class="detail-section">
            <div class="detail-label">密码</div>
            <div class="detail-value" id="pwValue">${showPassword ? p.password : '••••••••••••'}</div>
            <div class="detail-actions">
              <button class="btn btn-secondary" id="btnTogglePw">${showPassword ? '隐藏' : '显示'}</button>
              <button class="btn btn-primary" id="btnCopyPw">复制密码</button>
            </div>
          </div>
          ${p.url ? `<div class="detail-section"><div class="detail-label">网址</div><div class="detail-value">${p.url}</div></div>` : ''}
          ${p.note ? `<div class="detail-section"><div class="detail-label">备注</div><div class="detail-value" style="font-family:inherit">${p.note}</div></div>` : ''}
          <div class="detail-actions">
            <button class="btn btn-secondary" id="btnEdit">编辑</button>
            <button class="btn btn-danger" id="btnDelete">删除</button>
          </div>
        </div>
      </div>
    `

    const updatePwDisplay = () => {
      document.getElementById('pwValue').textContent = showPassword ? p.password : '••••••••••••'
      document.getElementById('btnTogglePw').textContent = showPassword ? '隐藏' : '显示'
    }

    document.getElementById('btnBack').addEventListener('click', () => renderHome())
    document.getElementById('btnEditDetail').addEventListener('click', () => { editingId = id; navigate('form') })
    document.getElementById('btnTogglePw').addEventListener('click', () => { showPassword = !showPassword; updatePwDisplay() })
    document.getElementById('btnCopyPw').addEventListener('click', () => copyToClipboard(p.password))
    document.getElementById('btnEdit').addEventListener('click', () => { editingId = id; navigate('form') })
    document.getElementById('btnDelete').addEventListener('click', async () => {
      if (confirm('确定删除这条密码记录吗？')) {
        await deleteEntry(id)
        await loadHomeData()
        renderHome()
        showToast('已删除')
      }
    })
  }

  // ===== 表单页 =====
  async function renderForm() {
    let form = { platform: '', username: '', password: '', url: '', note: '', categoryId: categoriesCache[0]?.id || 1, isFavorite: false }
    if (editingId) {
      const d = await getDecryptedEntry(editingId)
      if (d) form = { ...form, ...d.payload, categoryId: d.categoryId, isFavorite: d.isFavorite }
    }

    app.innerHTML = `
      <div class="form-screen">
        <div class="form-header">
          <button class="icon-btn" id="btnCancel">←</button>
          <span class="form-title">${editingId ? '编辑密码' : '添加密码'}</span>
          ${editingId ? '<button class="icon-btn" id="btnDelForm">🗑</button>' : '<div style="width:40px"></div>'}
        </div>
        <form id="entryForm" class="form-body">
          <div class="form-group"><label class="form-label">平台 / 应用名称</label><input type="text" id="platform" class="input-field" placeholder="例如 Google、微信" value="${form.platform}" required /></div>
          <div class="form-group"><label class="form-label">用户名 / 邮箱</label><input type="text" id="username" class="input-field" placeholder="登录账号" value="${form.username}" /></div>
          <div class="form-group">
            <label class="form-label">密码</label>
            <div class="password-field">
              <input type="password" id="password" class="input-field" placeholder="输入或生成密码" value="${form.password}" required />
              <div class="password-actions">
                <button type="button" class="small-btn" id="togglePw">显示</button>
                <button type="button" class="small-btn" id="genPw">生成</button>
              </div>
            </div>
          </div>
          <div class="form-group"><label class="form-label">网址（可选）</label><input type="text" id="url" class="input-field" placeholder="https://..." value="${form.url}" /></div>
          <div class="form-group">
            <label class="form-label">分类</label>
            <select id="categoryId" class="input-field">${categoriesCache.map(c => `<option value="${c.id}" ${c.id == form.categoryId ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
          </div>
          <div class="form-group checkbox-row"><input type="checkbox" id="isFavorite" ${form.isFavorite ? 'checked' : ''} /><label for="isFavorite">加入收藏</label></div>
          <div class="form-group"><label class="form-label">备注（可选）</label><textarea id="note" class="input-field textarea" placeholder="安全提示、二次验证等">${form.note}</textarea></div>
          <button type="submit" class="btn btn-primary btn-block">保存</button>
        </form>
      </div>
    `

    const pwInput = document.getElementById('password')
    document.getElementById('togglePw').addEventListener('click', () => {
      pwInput.type = pwInput.type === 'password' ? 'text' : 'password'
      document.getElementById('togglePw').textContent = pwInput.type === 'password' ? '显示' : '隐藏'
    })
    document.getElementById('genPw').addEventListener('click', () => {
      pwInput.value = generatePassword({ length: 16, includeUpper: true, includeLower: true, includeDigits: true, includeSymbols: true, excludeAmbiguous: true })
      pwInput.type = 'text'
      document.getElementById('togglePw').textContent = '隐藏'
    })
    document.getElementById('btnCancel').addEventListener('click', () => renderHome())
    if (editingId) {
      document.getElementById('btnDelForm').addEventListener('click', async () => {
        if (confirm('确定删除吗？')) {
          await deleteEntry(editingId)
          await loadHomeData()
          renderHome()
          showToast('已删除')
        }
      })
    }
    document.getElementById('entryForm').addEventListener('submit', async (e) => {
      e.preventDefault()
      const payload = {
        platform: document.getElementById('platform').value.trim(),
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value,
        url: document.getElementById('url').value.trim(),
        note: document.getElementById('note').value.trim()
      }
      const meta = {
        categoryId: Number(document.getElementById('categoryId').value),
        isFavorite: document.getElementById('isFavorite').checked
      }
      if (editingId) await updateEntry(editingId, payload, meta)
      else await addEntry(payload, meta)
      await loadHomeData()
      renderHome()
      showToast(editingId ? '已更新' : '已保存')
    })
  }

  // ===== 密码生成器 =====
  function renderGenerator() {
    let opts = { mode: 'random', length: 16, includeUpper: true, includeLower: true, includeDigits: true, includeSymbols: true, excludeAmbiguous: true, words: 4, separator: '-' }
    let generated = generatePassword(opts)

    function refresh() { generated = generatePassword(opts); updateDisplay() }
    function updateDisplay() {
      document.getElementById('pwdDisplay').textContent = generated
      const s = estimateStrength(generated)
      const fill = document.getElementById('strengthFill')
      fill.style.width = Math.min(100, generated.length * 6 + 10) + '%'
      fill.style.background = s.color
      document.getElementById('strengthLabel').textContent = s.label
      document.getElementById('strengthLabel').style.color = s.color
    }

    app.innerHTML = `
      <div class="form-screen">
        <div class="form-header">
          <button class="icon-btn" id="btnBack">←</button>
          <span class="form-title">密码生成器</span>
          <div style="width:40px"></div>
        </div>
        <div class="form-body">
          <div class="password-display" id="pwdDisplay"></div>
          <div class="strength-bar"><div class="strength-fill" id="strengthFill"></div></div>
          <p id="strengthLabel" style="text-align:center;margin-bottom:16px"></p>
          <div class="generator-options">
            <div class="mode-row">
              <button class="mode-btn ${opts.mode === 'random' ? 'active' : ''}" data-mode="random">随机</button>
              <button class="mode-btn ${opts.mode === 'memorable' ? 'active' : ''}" data-mode="memorable">助记</button>
              <button class="mode-btn ${opts.mode === 'pin' ? 'active' : ''}" data-mode="pin">PIN</button>
            </div>
            <div id="randomOptions" class="${opts.mode === 'random' ? '' : 'hidden'}">
              <div class="slider-row"><span>长度</span><input type="range" id="lenRange" min="6" max="64" value="${opts.length}" /><span id="lenVal">${opts.length}</span></div>
              <div class="checkbox-row"><input type="checkbox" id="upper" ${opts.includeUpper ? 'checked' : ''} /><label for="upper">大写字母</label></div>
              <div class="checkbox-row"><input type="checkbox" id="lower" ${opts.includeLower ? 'checked' : ''} /><label for="lower">小写字母</label></div>
              <div class="checkbox-row"><input type="checkbox" id="digits" ${opts.includeDigits ? 'checked' : ''} /><label for="digits">数字</label></div>
              <div class="checkbox-row"><input type="checkbox" id="symbols" ${opts.includeSymbols ? 'checked' : ''} /><label for="symbols">特殊符号</label></div>
              <div class="checkbox-row"><input type="checkbox" id="ambiguous" ${opts.excludeAmbiguous ? 'checked' : ''} /><label for="ambiguous">排除易混淆字符</label></div>
            </div>
            <div id="memorableOptions" class="${opts.mode === 'memorable' ? '' : 'hidden'}">
              <div class="slider-row"><span>词数</span><input type="range" id="wordRange" min="2" max="8" value="${opts.words}" /><span id="wordVal">${opts.words}</span></div>
              <div class="form-group"><label class="form-label">分隔符</label><input type="text" id="separator" class="input-field" value="${opts.separator}" /></div>
            </div>
            <div id="pinOptions" class="${opts.mode === 'pin' ? '' : 'hidden'}">
              <div class="slider-row"><span>位数</span><input type="range" id="pinRange" min="4" max="12" value="${opts.length}" /><span id="pinVal">${opts.length}</span></div>
            </div>
          </div>
          <div class="detail-actions">
            <button class="btn btn-secondary" id="btnRefresh">重新生成</button>
            <button class="btn btn-primary" id="btnCopy">复制</button>
          </div>
        </div>
      </div>
    `
    updateDisplay()

    document.getElementById('btnBack').addEventListener('click', () => renderHome())
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        opts.mode = btn.dataset.mode
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn))
        document.getElementById('randomOptions').classList.toggle('hidden', opts.mode !== 'random')
        document.getElementById('memorableOptions').classList.toggle('hidden', opts.mode !== 'memorable')
        document.getElementById('pinOptions').classList.toggle('hidden', opts.mode !== 'pin')
        refresh()
      })
    })
    document.getElementById('lenRange').addEventListener('input', (e) => { opts.length = Number(e.target.value); document.getElementById('lenVal').textContent = opts.length; refresh() })
    document.getElementById('wordRange').addEventListener('input', (e) => { opts.words = Number(e.target.value); document.getElementById('wordVal').textContent = opts.words; refresh() })
    document.getElementById('pinRange').addEventListener('input', (e) => { opts.length = Number(e.target.value); document.getElementById('pinVal').textContent = opts.length; refresh() })
    ;['upper','lower','digits','symbols','ambiguous'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', (e) => {
        if (id === 'ambiguous') opts.excludeAmbiguous = e.target.checked
        else opts[id === 'upper' ? 'includeUpper' : id === 'lower' ? 'includeLower' : id === 'digits' ? 'includeDigits' : 'includeSymbols'] = e.target.checked
        refresh()
      })
    })
    document.getElementById('separator').addEventListener('input', (e) => { opts.separator = e.target.value; refresh() })
    document.getElementById('btnRefresh').addEventListener('click', refresh)
    document.getElementById('btnCopy').addEventListener('click', () => copyToClipboard(generated))
  }

  // ===== 设置页 =====
  function renderSettings() {
    app.innerHTML = `
      <div class="form-screen">
        <div class="form-header">
          <button class="icon-btn" id="btnBack">←</button>
          <span class="form-title">设置</span>
          <div style="width:40px"></div>
        </div>
        <div class="form-body">
          <div class="settings-list">
            <button class="settings-item" id="btnLock"><span>立即锁定</span><span>🔒</span></button>
            <button class="settings-item" id="btnSecurity"><span>安全声明</span><span>🛡</span></button>
            <button class="settings-item" id="btnExport"><span>导出加密备份</span><span>↓</span></button>
            <button class="settings-item" id="btnImport"><span>导入加密备份</span><span>↑</span></button>
            <button class="settings-item" id="btnChangePw"><span>修改主密码</span><span>🔑</span></button>
            <button class="settings-item settings-item-danger" id="btnReset"><span>重置保险库</span><span>🗑</span></button>
          </div>
          <div style="margin-top:24px;color:var(--text-muted);font-size:13px;text-align:center">密安密码本 v0.1.0<br />本地加密，不上传服务器</div>
        </div>
      </div>
    `

    document.getElementById('btnBack').addEventListener('click', () => renderHome())
    document.getElementById('btnLock').addEventListener('click', () => { lockVault(); navigate('unlock') })
    document.getElementById('btnSecurity').addEventListener('click', renderSecurityStatement)
    document.getElementById('btnExport').addEventListener('click', exportBackup)
    document.getElementById('btnImport').addEventListener('click', importBackup)
    document.getElementById('btnChangePw').addEventListener('click', renderChangePassword)
    document.getElementById('btnReset').addEventListener('click', () => {
      app.innerHTML += `
        <div class="modal-overlay" id="resetModal">
          <div class="modal">
            <div class="modal-title">危险操作</div>
            <div class="modal-text">重置保险库将删除本地所有密码记录和主密码，且无法恢复。确定继续吗？</div>
            <div class="modal-actions">
              <button class="btn btn-secondary" id="cancelReset">取消</button>
              <button class="btn btn-danger" id="confirmReset">确认重置</button>
            </div>
          </div>
        </div>
      `
      document.getElementById('cancelReset').addEventListener('click', () => document.getElementById('resetModal').remove())
      document.getElementById('confirmReset').addEventListener('click', async () => {
        await resetVault()
        initialized = false
        navigate('unlock')
        showToast('保险库已重置')
      })
    })
  }

  // ===== 安全声明页 =====
  function renderSecurityStatement() {
    app.innerHTML = `
      <div class="form-screen">
        <div class="form-header">
          <button class="icon-btn" id="btnBack">←</button>
          <span class="form-title">安全声明</span>
          <div style="width:40px"></div>
        </div>
        <div class="form-body security-statement">
          <div class="statement-section">
            <h3>隐私与数据安全</h3>
            <p>密安密码本采用纯本地架构，所有密码数据仅保存在你的设备本地，不会上传到任何网络服务器。</p>
          </div>
          <div class="statement-section">
            <h3>不联网、不收集</h3>
            <p>应用运行过程中不会主动连接互联网，不会收集你的个人信息、设备信息或密码内容，也不会进行任何形式的追踪或分析。</p>
          </div>
          <div class="statement-section">
            <h3>本地加密</h3>
            <p>你的主密码不会以明文存储。我们使用 PBKDF2 派生密钥，配合 AES-GCM 加密算法，在本地浏览器或 WebView 中完成全部加解密运算。</p>
          </div>
          <div class="statement-section">
            <h3>备份与恢复</h3>
            <p>你可以随时导出加密备份文件到本地。备份文件同样经过加密处理，请妥善保管。</p>
          </div>
          <div class="statement-section">
            <h3>责任提示</h3>
            <p>请牢记主密码，遗忘后无法恢复数据。建议定期导出备份，并避免在公共设备上保存主密码。</p>
          </div>
          <div style="margin-top:24px;color:var(--text-muted);font-size:13px;text-align:center">密安密码本 v1.0.1</div>
        </div>
      </div>
    `
    document.getElementById('btnBack').addEventListener('click', () => renderSettings())
  }

  async function exportBackup() {
    const config = await dbGet(VAULT_STORE, 'config')
    const entries = await dbGetAll(ENTRIES_STORE)
    const data = { version: 1, exportedAt: Date.now(), config, entries }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mian_backup_${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('导出成功')
  }

  function importBackup() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async (e) => {
      const file = e.target.files[0]
      if (!file) return
      try {
        const data = JSON.parse(await file.text())
        if (!data.config || !data.entries) throw new Error('无效的备份文件')
        await dbPut(VAULT_STORE, data.config, 'config')
        for (const entry of data.entries) await dbPut(ENTRIES_STORE, entry)
        showToast('导入成功，请重新解锁')
        lockVault()
        initialized = true
        navigate('unlock')
      } catch (err) {
        showToast('导入失败：' + err.message)
      }
    }
    input.click()
  }

  function renderChangePassword() {
    app.innerHTML = `
      <div class="form-screen">
        <div class="form-header">
          <button class="icon-btn" id="btnBack">←</button>
          <span class="form-title">修改主密码</span>
          <div style="width:40px"></div>
        </div>
        <form id="changePwForm" class="form-body" style="display:flex;flex-direction:column;gap:16px">
          <input type="password" id="oldPw" class="input-field" placeholder="当前主密码" required />
          <input type="password" id="newPw" class="input-field" placeholder="新主密码（至少8位）" required />
          <input type="password" id="confirmPw" class="input-field" placeholder="确认新主密码" required />
          <p class="error-text" id="pwError"></p>
          <button type="submit" class="btn btn-primary btn-block">确认修改</button>
        </form>
      </div>
    `
    document.getElementById('btnBack').addEventListener('click', renderSettings)
    document.getElementById('changePwForm').addEventListener('submit', async (e) => {
      e.preventDefault()
      const err = document.getElementById('pwError')
      err.textContent = ''
      const oldPw = document.getElementById('oldPw').value
      const newPw = document.getElementById('newPw').value
      const confirmPw = document.getElementById('confirmPw').value
      if (newPw.length < 8) { err.textContent = '新密码至少 8 位'; return }
      if (newPw !== confirmPw) { err.textContent = '两次输入不一致'; return }
      try {
        await changeMasterPassword(oldPw, newPw)
        showToast('主密码已修改')
        renderSettings()
      } catch (e) { err.textContent = e.message || '修改失败' }
    })
  }

  // ===== 路由与启动 =====
  let initialized = false

  async function render() {
    if (currentScreen === 'unlock') {
      initialized = await isVaultSetup()
      renderUnlock()
      return
    }
    if (currentScreen === 'home') { renderHome(); return }
    if (currentScreen === 'form') { renderForm(); return }
    if (currentScreen === 'generator') { renderGenerator(); return }
    if (currentScreen === 'settings') { renderSettings(); return }
  }

  // 注册 Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {})
  }

  render()
})()
