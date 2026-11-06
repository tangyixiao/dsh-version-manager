/**
 * The browser half.
 *
 * Loaded by the DSH client as a module bundle: the wrapper below is the protocol
 * the host's module loader reads, and `apply`/`inject` are the two exports it
 * looks for. Everything this file needs is either `react` or the host UI
 * primitives package — both live in the client's static module table, so nothing
 * is fetched from the network at runtime.
 *
 * The panel never reads the filesystem and never runs a package manager. It asks
 * the host for a described state, draws it, and turns a click into one request
 * that names exactly what will change.
 */
window.__ModuleLoader__.load({
  id: 'dsh-version-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // `react` is the one module this file needs, and it is in the client's static
    // module table. Pulling in a UI package would add a second thing that can be
    // missing from a host version this plugin has not seen.
    const React = require('react')

    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const PANEL_ID = 'dsh-version-manager'
    const ROUTE_BASE = '/dsh-version-manager'

    // ---------------------------------------------------------------- language

    const COLORS = {
      pass: '#0d7f4f',
      warn: '#a86000',
      fail: '#b3261e',
      unknown: '#5b6470',
      idle: '#8a929c',
      line: 'rgba(0,0,0,0.10)',
      soft: 'rgba(0,0,0,0.04)',
    }

    const TEXT = {
      zh: {
        panel: '版本管理',
        title: '插件与 Skill 版本管理',
        subtitle: '查看当前 profile 的安装事实、检查更新、预览并执行单项更新、留快照',
        refresh: '刷新',
        refreshing: '正在读取…',
        profile: 'Profile',
        host: '宿主版本',
        observed: '读取时间',
        unknown: '未知',
        notAvailable: '不可获取',
        counts: (total, updatable, official) =>
          `${total} 个条目，${updatable} 个可更新，${official} 个官方内置`,
        filterAll: '全部',
        filterUpdatable: '可更新',
        filterReadOnly: '只读',
        search: '按名称过滤',
        colName: '包',
        colVersion: '已装版本',
        colSource: '来源',
        colLoad: '加载状态',
        colCompat: '兼容性',
        colActions: '操作',
        checkVersions: '检查更新',
        checking: '检查中…',
        takeSnapshot: '拍快照',
        snapshotting: '快照中…',
        details: '详情',
        hide: '收起',
        declared: '安装声明',
        declaredObserved: 'profile 中记录',
        declaredMatches: '一致',
        declaredDiffers: '不一致',
        registry: 'registry',
        registryUnknown: '快照外无法确认',
        official: '官方',
        readOnly: '只读',
        noNewerVersions: '没有更新的版本',
        stable: '正式版',
        prerelease: '预发布',
        published: '发布于',
        deprecated: '已废弃',
        versionListRefused: '该条目不可更新',
        updateTo: '更新到',
        confirmTitle: '确认这次更新',
        confirmBody: (name, from, to) =>
          `将把 ${name} 从 ${from} 更新到 ${to}。宿主会先移除再安装，中间会有一次完整重装。`,
        confirmNotes: [
          '更新前会自动拍一份快照，并在执行前回读校验。',
          '宿主会把依赖保存为精确版本，原来若是版本范围则会被替换。',
          '不会恢复配置、依赖树或 agent preset。',
          '不会自动重启宿主。',
        ],
        cancel: '取消',
        confirm: '确认更新',
        updating: '更新中…',
        updateOk: '更新完成',
        updateFailed: '更新未完成',
        alreadyLatest: '已是最新版本',
        snapshots: '快照',
        noSnapshots: '还没有快照',
        restore: '恢复此版本',
        restoreConfirm: (v) => `将把版本恢复到 ${v}。只恢复版本，不恢复配置。`,
        restoring: '恢复中…',
        restoreRefused: '无法安全恢复',
        operations: '最近操作',
        noOperations: '还没有操作记录',
        unresolved: '有未收尾的操作',
        loadActive: '已加载',
        loadFailed: '加载失败',
        loadPending: '待加载',
        loadLoading: '加载中',
        loadUnloading: '卸载中',
        loadUnknown: '未知',
        compatOk: '满足',
        compatFail: '不满足',
        compatUnknown: '未知',
        compatExempted: '已豁免',
        errorLabel: '错误',
        notStarted: '尚未读取',
        started: '开始读取',
        requestFailed: (status) => `请求失败（HTTP ${status}）`,
        networkFailed: '无法连接到宿主接口',
        staleWarning: '这些数据来自上一次读取，可能已经过期',
        skillsSoon: 'Skill 版本管理在下一阶段提供；当前面板只处理插件。',
      },
      en: {
        panel: 'Versions',
        title: 'Plugin and Skill versions',
        subtitle:
          'What this profile actually has installed, which updates exist, and one change at a time',
        refresh: 'Refresh',
        refreshing: 'Reading…',
        profile: 'Profile',
        host: 'Host version',
        observed: 'Observed',
        unknown: 'unknown',
        notAvailable: 'not available',
        counts: (total, updatable, official) =>
          `${total} entries, ${updatable} updatable, ${official} official`,
        filterAll: 'All',
        filterUpdatable: 'Updatable',
        filterReadOnly: 'Read-only',
        search: 'Filter by name',
        colName: 'Package',
        colVersion: 'Installed',
        colSource: 'Source',
        colLoad: 'Load state',
        colCompat: 'Compatibility',
        colActions: 'Actions',
        checkVersions: 'Check versions',
        checking: 'Checking…',
        takeSnapshot: 'Snapshot',
        snapshotting: 'Snapshotting…',
        details: 'Details',
        hide: 'Collapse',
        declared: 'Declared spec',
        declaredObserved: 'Recorded in profile',
        declaredMatches: 'matches',
        declaredDiffers: 'differs',
        registry: 'registry',
        registryUnknown: 'not confirmable from here',
        official: 'official',
        readOnly: 'read-only',
        noNewerVersions: 'No newer versions',
        stable: 'Stable',
        prerelease: 'Prerelease',
        published: 'published',
        deprecated: 'deprecated',
        versionListRefused: 'This entry cannot be updated',
        updateTo: 'Update to',
        confirmTitle: 'Confirm this update',
        confirmBody: (name, from, to) =>
          `Update ${name} from ${from} to ${to}. The host removes then installs, so this is a full reinstall.`,
        confirmNotes: [
          'A snapshot is taken first and read back before anything changes.',
          'The host saves an exact version; a range in the profile is replaced.',
          'Configuration, the dependency tree and agent presets are not restored.',
          'The host is not restarted.',
        ],
        cancel: 'Cancel',
        confirm: 'Update',
        updating: 'Updating…',
        updateOk: 'Update finished',
        updateFailed: 'Update did not finish',
        alreadyLatest: 'Already at the newest version',
        snapshots: 'Snapshots',
        noSnapshots: 'No snapshots yet',
        restore: 'Restore this version',
        restoreConfirm: (v) => `Restore the version to ${v}. Only the version is restored.`,
        restoring: 'Restoring…',
        restoreRefused: 'Cannot restore safely',
        operations: 'Recent operations',
        noOperations: 'No operations recorded',
        unresolved: 'An operation has not settled',
        loadActive: 'active',
        loadFailed: 'failed',
        loadPending: 'pending',
        loadLoading: 'loading',
        loadUnloading: 'unloading',
        loadUnknown: 'unknown',
        compatOk: 'met',
        compatFail: 'not met',
        compatUnknown: 'unknown',
        compatExempted: 'exempted',
        errorLabel: 'Error',
        notStarted: 'Not read yet',
        started: 'Read started',
        requestFailed: (status) => `Request failed (HTTP ${status})`,
        networkFailed: 'Could not reach the host route',
        staleWarning: 'This data came from an earlier read and may be out of date',
        skillsSoon:
          'Skill version management comes in the next stage; this panel handles plugins only.',
      },
    }

    /**
     * Pick a language once per mount. There is no language switcher here on
     * purpose: DSH already has one, and a second source of truth would drift.
     */
    function pickLanguage() {
      const candidates = []
      try {
        candidates.push(window.navigator?.language ?? '')
        candidates.push(...(window.navigator?.languages ?? []))
      } catch {
        // A browser that refuses to answer gets English, which is always safe.
      }
      for (const value of candidates) {
        if (typeof value === 'string' && value.toLowerCase().startsWith('zh')) return 'zh'
      }
      return 'en'
    }

    // ------------------------------------------------------------------ fetch

    /**
     * @param {string} path
     * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} options
     */
    async function request(path, options = {}) {
      const method = options.method ?? 'GET'
      const init = {
        method,
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal: options.signal,
      }
      if (options.body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(options.body)
      }
      let response
      try {
        response = await fetch(`${ROUTE_BASE}${path}`, init)
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        const failure = new Error('network')
        failure.kind = 'network'
        failure.cause = error
        throw failure
      }
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok) {
        const failure = new Error(body?.message ?? body?.error ?? `HTTP ${response.status}`)
        failure.kind = 'http'
        failure.status = response.status
        failure.body = body
        throw failure
      }
      return body
    }

    // ------------------------------------------------------------------- time

    function formatTime(value, language) {
      if (typeof value !== 'string' || value === '') return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value
      const locale = language === 'zh' ? 'zh-CN' : 'en-US'
      return new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
    }

    // ------------------------------------------------------------------ atoms

    function Dot(props) {
      const color = props.tone === 'pass' ? COLORS.pass : props.tone === 'warn' ? COLORS.warn : props.tone === 'fail' ? COLORS.fail : COLORS.idle
      return h('span', {
        'aria-hidden': 'true',
        style: {
          display: 'inline-block',
          width: 7,
          height: 7,
          borderRadius: 999,
          background: color,
          marginRight: 6,
          flex: '0 0 auto',
        },
      })
    }

    function Badge(props) {
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '1px 7px',
            borderRadius: 999,
            border: `1px solid ${COLORS.line}`,
            background: COLORS.soft,
            fontSize: 11,
            lineHeight: 1.6,
            whiteSpace: 'nowrap',
          },
        },
        props.children,
      )
    }

    function Button(props) {
      return h(
        'button',
        {
          type: 'button',
          onClick: props.onClick,
          disabled: props.disabled === true,
          title: props.title,
          'aria-label': props.ariaLabel ?? props.children,
          style: {
            font: 'inherit',
            fontSize: 12,
            padding: '3px 9px',
            borderRadius: 6,
            border: `1px solid ${COLORS.line}`,
            background: props.primary === true ? '#1f6feb' : 'transparent',
            color: props.primary === true ? '#fff' : 'inherit',
            cursor: props.disabled === true ? 'default' : 'pointer',
            opacity: props.disabled === true ? 0.5 : 1,
            whiteSpace: 'nowrap',
          },
        },
        props.children,
      )
    }

    function Notice(props) {
      const tone = props.tone ?? 'warn'
      const color = tone === 'fail' ? COLORS.fail : tone === 'pass' ? COLORS.pass : COLORS.warn
      return h(
        'div',
        {
          role: props.role ?? 'status',
          style: {
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            borderLeft: `3px solid ${color}`,
            background: COLORS.soft,
            padding: '6px 10px',
            borderRadius: 4,
            fontSize: 12,
            margin: '6px 0',
          },
        },
        h(
          'div',
          { style: { flex: '1 1 auto', minWidth: 0 } },
          h('div', { style: { fontWeight: 600 } }, props.title),
          props.children === undefined
            ? null
            : h('div', { style: { opacity: 0.85, marginTop: 2, wordBreak: 'break-word' } }, props.children),
        ),
      )
    }

    function Field(props) {
      return h(
        'div',
        { style: { display: 'flex', gap: 6, fontSize: 12, marginTop: 3, flexWrap: 'wrap' } },
        h('span', { style: { opacity: 0.6, minWidth: 96 } }, props.label),
        h('span', { style: { wordBreak: 'break-all' } }, props.value === null || props.value === undefined || props.value === '' ? '—' : props.value),
      )
    }

    // ------------------------------------------------------------- presentation

    function loadTone(row) {
      if (row.loadStateAvailable !== true) return 'idle'
      if (row.loadState === 'failed') return 'fail'
      if (row.loadState === 'active') return 'pass'
      if (row.loadState === 'unloading') return 'warn'
      return 'idle'
    }

    function loadLabel(row, t) {
      if (row.loadStateAvailable !== true) return t.loadUnknown
      switch (row.loadState) {
        case 'active':
          return t.loadActive
        case 'failed':
          return t.loadFailed
        case 'pending':
          return t.loadPending
        case 'loading':
          return t.loadLoading
        case 'unloading':
          return t.loadUnloading
        default:
          return t.loadUnknown
      }
    }

    function compatLabel(row, t) {
      const verdict = row.compatibility?.verdict
      if (verdict === undefined || verdict === null || verdict === 'unknown') return t.compatUnknown
      if (verdict === 'exempted') return t.compatExempted
      if (verdict === 'met' || verdict === 'ok') return t.compatOk
      return t.compatFail
    }

    function compatTone(row) {
      const verdict = row.compatibility?.verdict
      if (verdict === 'met' || verdict === 'ok') return 'pass'
      if (verdict === 'exempted') return 'warn'
      if (verdict === undefined || verdict === null || verdict === 'unknown') return 'idle'
      return 'fail'
    }

    function sourceLabel(row, t) {
      const source = row.source ?? {}
      if (source.kind === 'registry') return source.registryName ?? t.unknown
      if (typeof source.detail === 'string' && source.detail !== '') return source.detail
      return source.kind ?? t.unknown
    }

    function VersionPicker(props) {
      const { t, language, data, onPick, busyVersion, installed } = props
      if (data === null) return null
      if (data.status !== 'ok') {
        return h(
          Notice,
          { tone: 'warn', title: t.versionListRefused },
          data.message ?? data.reason ?? data.status,
        )
      }
      if (data.versions.length === 0) {
        return h('div', { style: { fontSize: 12, opacity: 0.7, margin: '6px 0' } }, t.noNewerVersions)
      }
      const renderGroup = (label, items) =>
        items.length === 0
          ? null
          : h(
              'div',
              { style: { marginTop: 6 } },
              h('div', { style: { fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 } }, label),
              h(
                'ul',
                { style: { listStyle: 'none', margin: '4px 0 0', padding: 0 } },
                items.map((item) =>
                  h(
                    'li',
                    {
                      key: item.version,
                      style: {
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        padding: '3px 0',
                        borderTop: `1px solid ${COLORS.line}`,
                        fontSize: 12,
                      },
                    },
                    h('code', { style: { fontFamily: 'ui-monospace, monospace' } }, item.version),
                    item.version === installed ? h(Badge, null, t.colVersion) : null,
                    item.deprecated !== null && item.deprecated !== undefined ? h(Badge, null, t.deprecated) : null,
                    item.isBundle === false ? h(Badge, null, 'not a bundle') : null,
                    item.compatibility !== null && item.compatibility !== undefined && item.compatibility.exempted !== true
                      ? h(Badge, null, item.compatibility.requirements ? t.compatFail : t.compatOk)
                      : null,
                    h('span', { style: { opacity: 0.6, marginLeft: 'auto' } },
                      item.publishedAt === null ? '' : `${t.published} ${formatTime(item.publishedAt, language)}`),
                    h(
                      Button,
                      {
                        onClick: () => onPick(item),
                        disabled: busyVersion !== null,
                        primary: false,
                        ariaLabel: `${t.updateTo} ${item.version}`,
                      },
                      busyVersion === item.version ? t.updating : t.updateTo,
                    ),
                  ),
                ),
              ),
            )
      return h(
        'div',
        null,
        renderGroup(t.stable, data.stable),
        renderGroup(t.prerelease, data.prerelease),
      )
    }

    function SnapshotList(props) {
      const { t, language, snapshots, installed, onRestore, busy } = props
      if (snapshots.length === 0) {
        return h('div', { style: { fontSize: 12, opacity: 0.7, marginTop: 4 } }, t.noSnapshots)
      }
      return h(
        'ul',
        { style: { listStyle: 'none', margin: '4px 0 0', padding: 0 } },
        snapshots
          .slice()
          .reverse()
          .map((snapshot) =>
            h(
              'li',
              {
                key: snapshot.id,
                style: {
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  fontSize: 12,
                  padding: '3px 0',
                  borderTop: `1px solid ${COLORS.line}`,
                },
              },
              h('code', { style: { fontFamily: 'ui-monospace, monospace' } }, snapshot.installedVersion ?? '—'),
              h('span', { style: { opacity: 0.65 } }, formatTime(snapshot.takenAt, language)),
              snapshot.reason === 'unreadable' ? h(Badge, null, snapshot.reason) : null,
              snapshot.installedVersion === installed ? h(Badge, null, t.colVersion) : null,
              h(
                'span',
                { style: { marginLeft: 'auto' } },
                h(
                  Button,
                  {
                    onClick: () => onRestore(snapshot),
                    disabled: busy !== null || snapshot.reason === 'unreadable',
                    ariaLabel: `${t.restore} ${snapshot.installedVersion ?? ''}`,
                  },
                  t.restore,
                ),
              ),
            ),
          ),
      )
    }

    function ConfirmBar(props) {
      const { t, title, body, notes, onCancel, onConfirm, busy, confirmLabel } = props
      return h(
        'div',
        {
          role: 'group',
          'aria-label': title,
          style: {
            border: `1px solid ${COLORS.line}`,
            borderRadius: 8,
            padding: '8px 10px',
            marginTop: 8,
            background: COLORS.soft,
          },
        },
        h('div', { style: { fontSize: 12, fontWeight: 600 } }, title),
        body === null ? null : h('div', { style: { fontSize: 12, marginTop: 4 } }, body),
        notes === null || notes === undefined
          ? null
          : h(
              'ul',
              { style: { margin: '6px 0 0', paddingLeft: 18, fontSize: 11.5, opacity: 0.8 } },
              notes.map((note, index) => h('li', { key: index }, note)),
            ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, marginTop: 8 } },
          h(Button, { onClick: onCancel, disabled: busy }, t.cancel),
          h(Button, { onClick: onConfirm, disabled: busy, primary: true }, busy ? '…' : confirmLabel ?? t.confirm),
        ),
      )
    }

    function Row(props) {
      const { row, t, language, expanded, onToggle, onRefresh } = props
      const [versions, setVersions] = useState(null)
      const [versionsBusy, setVersionsBusy] = useState(false)
      const [versionsError, setVersionsError] = useState(null)
      const [pendingUpdate, setPendingUpdate] = useState(null)
      const [updateBusy, setUpdateBusy] = useState(false)
      const [result, setResult] = useState(null)
      const [snapshotBusy, setSnapshotBusy] = useState(false)
      const [pendingRestore, setPendingRestore] = useState(null)
      const [restoreBusy, setRestoreBusy] = useState(false)

      const loadVersions = useCallback(async () => {
        setVersionsBusy(true)
        setVersionsError(null)
        try {
          setVersions(await request(`/versions?target=${encodeURIComponent(row.targetId)}`))
        } catch (error) {
          setVersionsError(error)
        } finally {
          setVersionsBusy(false)
        }
      }, [row.targetId])

      const takeSnapshot = useCallback(async () => {
        setSnapshotBusy(true)
        setResult(null)
        try {
          const body = await request('/snapshot', {
            method: 'POST',
            body: { targetId: row.targetId, reason: 'manual', confirm: true },
          })
          setResult({ ok: true, message: `${t.snapshots}: ${body.snapshot.id.slice(0, 8)}` })
          await onRefresh()
        } catch (error) {
          setResult({ ok: false, message: describeError(error, t) })
        } finally {
          setSnapshotBusy(false)
        }
      }, [row.targetId, onRefresh, t])

      const runUpdate = useCallback(async () => {
        if (pendingUpdate === null) return
        setUpdateBusy(true)
        try {
          const body = await request('/update', {
            method: 'POST',
            body: {
              targetId: row.targetId,
              toVersion: pendingUpdate.version,
              allowPrerelease: pendingUpdate.prerelease === true,
              confirm: true,
            },
          })
          setResult({
            ok: body.ok === true,
            message:
              body.ok === true
                ? `${t.updateOk}: ${body.fromVersion} → ${body.observedVersion ?? body.toVersion}`
                : `${t.updateFailed}: ${body.message ?? ''}`,
          })
          setPendingUpdate(null)
          await onRefresh()
        } catch (error) {
          setResult({ ok: false, message: describeError(error, t) })
        } finally {
          setUpdateBusy(false)
        }
      }, [pendingUpdate, row.targetId, onRefresh, t])

      const runRestore = useCallback(async () => {
        if (pendingRestore === null) return
        setRestoreBusy(true)
        try {
          const body = await request('/restore', {
            method: 'POST',
            body: { targetId: row.targetId, snapshotId: pendingRestore.id, confirm: true },
          })
          setResult({
            ok: body.ok === true,
            message: body.ok === true ? `${t.updateOk}: ${body.restoredVersion}` : `${t.updateFailed}: ${body.message ?? ''}`,
          })
          setPendingRestore(null)
          await onRefresh()
        } catch (error) {
          const failure = describeError(error, t)
          setResult({
            ok: false,
            message: error?.body?.error === 'files-changed' || error?.status === 409 ? `${t.restoreRefused}: ${failure}` : failure,
          })
        } finally {
          setRestoreBusy(false)
        }
      }, [pendingRestore, row.targetId, onRefresh, t])

      const updatable = row.updateRefusal === null

      const summaryRow = h(
        'tr',
        { style: { borderTop: `1px solid ${COLORS.line}` } },
        h(
          'td',
          { style: { padding: '6px 8px', verticalAlign: 'top' } },
          h('button', {
            type: 'button',
            onClick: onToggle,
            'aria-expanded': expanded,
            style: {
              font: 'inherit',
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'inherit',
              cursor: 'pointer',
              textAlign: 'left',
            },
          },
            h('span', { style: { marginRight: 6, opacity: 0.6 } }, expanded ? '▾' : '▸'),
            h(
              'span',
              { style: { fontWeight: 500, wordBreak: 'break-word' } },
              row.targetId,
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' } },
            row.official === true ? h(Badge, null, t.official) : null,
            updatable ? null : h(Badge, null, t.readOnly),
            row.prerelease === true ? h(Badge, null, t.prerelease) : null,
          ),
        ),
        h(
          'td',
          { style: { padding: '6px 8px', verticalAlign: 'top', fontFamily: 'ui-monospace, monospace', fontSize: 12 } },
          row.installedVersion ?? t.unknown,
        ),
        h('td', { style: { padding: '6px 8px', verticalAlign: 'top', fontSize: 12, wordBreak: 'break-word' } }, sourceLabel(row, t)),
        h(
          'td',
          { style: { padding: '6px 8px', verticalAlign: 'top', fontSize: 12, whiteSpace: 'nowrap' } },
          h(Dot, { tone: loadTone(row) }),
          loadLabel(row, t),
        ),
        h(
          'td',
          { style: { padding: '6px 8px', verticalAlign: 'top', fontSize: 12, whiteSpace: 'nowrap' } },
          h(Dot, { tone: compatTone(row) }),
          compatLabel(row, t),
        ),
        h(
          'td',
          { style: { padding: '6px 8px', verticalAlign: 'top' } },
          h(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(
              Button,
              {
                onClick: loadVersions,
                disabled: !updatable || versionsBusy,
                title: updatable ? undefined : row.updateRefusal ?? '',
              },
              versionsBusy ? t.checking : t.checkVersions,
            ),
            h(Button, { onClick: takeSnapshot, disabled: snapshotBusy || row.loadState === 'failed' }, snapshotBusy ? t.snapshotting : t.takeSnapshot),
          ),
        ),
      )

      const details = !expanded
        ? null
        : h(
            'tr',
            null,
            h(
              'td',
              { colSpan: 6, style: { padding: '4px 8px 12px 26px', background: COLORS.soft } },
              h(Field, { label: t.declared, value: row.declaredSpec }),
              h(Field, {
                label: t.declaredObserved,
                value:
                  row.declaredSpecObserved === null
                    ? null
                    : `${row.declaredSpecObserved} (${row.declaredSpecMatchesManifest ? t.declaredMatches : t.declaredDiffers})`,
              }),
              h(Field, { label: t.registry, value: row.source?.registry ?? `${t.unknown} — ${row.source?.registryReason ?? t.registryUnknown}` }),
              h(Field, { label: t.colLoad, value: `${loadLabel(row, t)}${row.loadStateAvailable === true ? '' : ` — ${t.notAvailable}`}` }),
              row.loadError === null || row.loadError === undefined
                ? null
                : h(Field, { label: t.errorLabel, value: row.loadError }),
              row.compatibility?.detail === null || row.compatibility?.detail === undefined
                ? null
                : h(Field, { label: t.colCompat, value: row.compatibility.detail }),
              row.updateRefusal === null ? null : h(Field, { label: t.readOnly, value: row.updateRefusal }),

              h('div', { style: { marginTop: 10 } }, h('div', { style: { fontSize: 12, fontWeight: 600 } }, t.snapshots),
                h(SnapshotList, {
                  t,
                  language,
                  snapshots: row.snapshots ?? [],
                  installed: row.installedVersion,
                  busy: restoreBusy ? 'x' : null,
                  onRestore: (snapshot) => setPendingRestore(snapshot),
                }),
              ),

              versionsError === null ? null : h(Notice, { tone: 'fail', title: t.networkFailed }, describeError(versionsError, t)),
              h(VersionPicker, {
                t,
                language,
                data: versions,
                installed: row.installedVersion,
                busyVersion: updateBusy ? pendingUpdate?.version ?? null : null,
                onPick: (item) => setPendingUpdate({ version: item.version, prerelease: item.prerelease }),
              }),

              pendingUpdate === null
                ? null
                : h(ConfirmBar, {
                    t,
                    title: t.confirmTitle,
                    body: t.confirmBody(row.targetId, row.installedVersion ?? t.unknown, pendingUpdate.version),
                    notes: t.confirmNotes,
                    busy: updateBusy,
                    onCancel: () => setPendingUpdate(null),
                    onConfirm: runUpdate,
                  }),

              pendingRestore === null
                ? null
                : h(ConfirmBar, {
                    t,
                    title: t.confirmTitle,
                    body: t.restoreConfirm(pendingRestore.installedVersion),
                    notes: null,
                    busy: restoreBusy,
                    onCancel: () => setPendingRestore(null),
                    onConfirm: runRestore,
                  }),

              result === null
                ? null
                : h(Notice, { tone: result.ok ? 'pass' : 'fail', title: result.message }, null),
            ),
          )

      return h(React.Fragment, null, summaryRow, details)
    }

    /**
     * Turn a failure into one sentence a person can act on.
     *
     * @param {any} error
     * @param {any} t
     * @returns {string}
     */
    function describeError(error, t) {
      if (error === null || error === undefined) return t.unknown
      if (error.kind === 'network') return t.networkFailed
      if (error.kind === 'http') return t.requestFailed(error.status)
      return String(error.message ?? error)
    }

    function OperationsList(props) {
      const { t, language, operations } = props
      if (operations.length === 0) {
        return h('div', { style: { fontSize: 12, opacity: 0.7 } }, t.noOperations)
      }
      const toneOf = (state) =>
        state === 'succeeded' ? 'pass' : state === 'recovery_required' ? 'fail' : state === 'failed' ? 'fail' : 'warn'
      return h(
        'ul',
        { style: { listStyle: 'none', margin: 0, padding: 0 } },
        operations.map((operation) =>
          h(
            'li',
            {
              key: operation.id,
              style: { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, padding: '3px 0', borderTop: `1px solid ${COLORS.line}` },
            },
            h(Dot, { tone: toneOf(operation.state) }),
            h('span', { style: { fontWeight: 500 } }, operation.state),
            h('code', { style: { fontFamily: 'ui-monospace, monospace' } }, operation.targetId ?? '—'),
            operation.fromVersion === null
              ? null
              : h('span', { style: { opacity: 0.7 } }, `${operation.fromVersion} → ${operation.toVersion ?? '?'}`),
            h('span', { style: { marginLeft: 'auto', opacity: 0.6 } }, formatTime(operation.startedAt, language)),
          ),
        ),
      )
    }

    function Panel() {
      const language = useMemo(pickLanguage, [])
      const t = TEXT[language]
      const [state, setState] = useState({ status: 'idle', data: null, error: null })
      const [filter, setFilter] = useState('all')
      const [query, setQuery] = useState('')
      const [expanded, setExpanded] = useState(null)
      const abortRef = useRef(null)

      const refresh = useCallback(async () => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller
        setState((previous) => ({ ...previous, status: 'loading' }))
        try {
          const data = await request('/overview', { signal: controller.signal })
          setState({ status: 'ready', data, error: null })
        } catch (error) {
          if (error?.name === 'AbortError') return
          setState((previous) => ({
            status: 'failed',
            // Keep the previous document on screen: an old list is still useful,
            // and the banner says it may be out of date.
            data: previous.data,
            error,
          }))
        }
      }, [])

      useEffect(() => {
        refresh()
        return () => abortRef.current?.abort()
      }, [refresh])

      const rows = state.data?.plugins ?? []
      const visible = useMemo(() => {
        const needle = query.trim().toLowerCase()
        return rows.filter((row) => {
          if (filter === 'updatable' && row.updateRefusal !== null) return false
          if (filter === 'readonly' && row.updateRefusal === null) return false
          if (needle !== '' && !String(row.targetId).toLowerCase().includes(needle)) return false
          return true
        })
      }, [rows, filter, query])

      const header = h(
        'div',
        { style: { display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' } },
        h(
          'div',
          { style: { flex: '1 1 320px', minWidth: 0 } },
          h('div', { style: { fontSize: 15, fontWeight: 600 } }, t.title),
          h('div', { style: { fontSize: 12, opacity: 0.7, marginTop: 2 } }, t.subtitle),
          h(
            'div',
            { style: { display: 'flex', gap: 14, marginTop: 6, fontSize: 12, flexWrap: 'wrap', opacity: 0.85 } },
            h('span', null, `${t.profile}: ${state.data?.profile?.id ?? t.notStarted}`),
            h('span', null, `${t.host}: ${state.data?.host?.runtimeVersion ?? t.unknown}`),
            h('span', null, `${t.observed}: ${state.data === null ? '—' : formatTime(state.data.observedAt, language)}`),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h(Button, { onClick: refresh, disabled: state.status === 'loading' }, state.status === 'loading' ? t.refreshing : t.refresh),
        ),
      )

      const toolbar = h(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 6px', flexWrap: 'wrap' } },
        h(
          'div',
          { role: 'group', 'aria-label': t.filterAll, style: { display: 'inline-flex', gap: 4 } },
          [
            ['all', t.filterAll],
            ['updatable', t.filterUpdatable],
            ['readonly', t.filterReadOnly],
          ].map(([key, label]) =>
            h(
              Button,
              {
                key,
                onClick: () => setFilter(key),
                primary: filter === key,
              },
              label,
            ),
          ),
        ),
        h('input', {
          type: 'search',
          value: query,
          onChange: (event) => setQuery(event.target.value),
          placeholder: t.search,
          'aria-label': t.search,
          style: {
            font: 'inherit',
            fontSize: 12,
            padding: '3px 8px',
            borderRadius: 6,
            border: `1px solid ${COLORS.line}`,
            background: 'transparent',
            color: 'inherit',
            minWidth: 180,
          },
        }),
        state.data === null
          ? null
          : h('span', { style: { fontSize: 12, opacity: 0.7 } }, t.counts(state.data.counts.total, state.data.counts.updatable, state.data.counts.official)),
      )

      const table = h(
        'table',
        { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
        h(
          'thead',
          null,
          h(
            'tr',
            { style: { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 } },
            h('th', { scope: 'col', style: { padding: '4px 8px', fontWeight: 500 } }, t.colName),
            h('th', { scope: 'col', style: { padding: '4px 8px', fontWeight: 500 } }, t.colVersion),
            h('th', { scope: 'col', style: { padding: '4px 8px', fontWeight: 500 } }, t.colSource),
            h('th', { scope: 'col', style: { padding: '4px 8px', fontWeight: 500 } }, t.colLoad),
            h('th', { scope: 'col', style: { padding: '4px 8px', fontWeight: 500 } }, t.colCompat),
            h('th', { scope: 'col', style: { padding: '4px 8px', fontWeight: 500 } }, t.colActions),
          ),
        ),
        h(
          'tbody',
          null,
          visible.map((row) =>
            h(Row, {
              key: row.targetId,
              row,
              t,
              language,
              expanded: expanded === row.targetId,
              onToggle: () => setExpanded((current) => (current === row.targetId ? null : row.targetId)),
              onRefresh: refresh,
            }),
          ),
        ),
      )

      return h(
        'div',
        { style: { padding: '18px 20px 32px', maxWidth: 1100, margin: '0 auto' } },
        header,
        state.error === null
          ? null
          : h(
              Notice,
              { tone: 'fail', title: state.data === null ? t.networkFailed : t.staleWarning },
              describeError(state.error, t),
            ),
        state.data?.error === null || state.data?.error === undefined
          ? null
          : h(Notice, { tone: 'fail', title: t.errorLabel }, state.data.error),
        state.data?.unresolved?.length
          ? h(Notice, { tone: 'warn', title: t.unresolved }, state.data.unresolved.join(', '))
          : null,
        state.status === 'idle' ? h('div', { style: { fontSize: 12, opacity: 0.7 } }, t.started) : null,
        toolbar,
        state.data === null
          ? null
          : visible.length === 0
            ? h('div', { style: { fontSize: 12, opacity: 0.7, padding: '12px 0' } }, t.noNewerVersions)
            : table,
        state.data === null
          ? null
          : h(
              'div',
              { style: { marginTop: 18 } },
              h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, t.operations),
              h(OperationsList, { t, language, operations: state.data.operations ?? [] }),
            ),
        h('div', { style: { marginTop: 18, fontSize: 11, opacity: 0.6 } }, t.skillsSoon),
      )
    }

    // --------------------------------------------------------------- register

    function Icon(props) {
      const size = typeof props?.size === 'number' ? props.size : 18
      const active = props?.active === true
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 2 : 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        // Three stacked bars: the shape of a list of versions, readable at 16px.
        h('path', { d: 'M4 6h16' }),
        h('path', { d: 'M4 12h16' }),
        h('path', { d: 'M4 18h10' }),
        h('circle', { cx: 19, cy: 18, r: 2.2 }),
      )
    }

    /**
     * @param {any} ctx
     */
    function apply(ctx) {
      let locale = null
      try {
        locale = ctx.get('locale')
      } catch {
        locale = null
      }

      const label = () => {
        const language = pickLanguage()
        return TEXT[language].panel
      }

      try {
        if (locale !== null && locale !== undefined && typeof locale.register === 'function') {
          // Registering the namespace is optional: the panel ships its own
          // strings, and this only lets the host re-render on language change.
          ctx.effect(
            () => locale.register(PANEL_ID, { zh: { panel: TEXT.zh.panel }, en: { panel: TEXT.en.panel } }),
            'dsh-version-manager: locale',
          )
        }
      } catch (error) {
        console.error('dsh-version-manager: locale registration failed', error)
      }

      ctx.slots.inject('main', () => {
        const stopMain = ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            inject: () => ({}),
          },
          Panel,
        )
        const stopIcon = ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 60,
            label,
          },
          Icon,
        )
        return () => {
          try {
            if (typeof stopIcon === 'function') stopIcon()
          } catch (error) {
            console.error('dsh-version-manager: sidebar cleanup failed', error)
          }
          try {
            if (typeof stopMain === 'function') stopMain()
          } catch (error) {
            console.error('dsh-version-manager: panel cleanup failed', error)
          }
        }
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
