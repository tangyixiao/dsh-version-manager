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
      // Mid grey rather than black-with-alpha: the same separator has to be
      // visible on the light and the dark surface without a theme query.
      line: 'rgba(128,128,128,0.32)',
      soft: 'rgba(128,128,128,0.10)',
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
        counts: (total, writable, official, unsatisfied, unknownCompat) => {
          const base = `${total} 个条目，${writable} 个可写入，${official} 个官方内置`
          const parts = []
          if (unsatisfied > 0) parts.push(`${unsatisfied} 个与当前宿主版本不匹配`)
          if (unknownCompat > 0) parts.push(`${unknownCompat} 个兼容性未能判定`)
          return parts.length === 0 ? base : `${base}，${parts.join('，')}`
        },
        filterAll: '全部',
        filterWritable: '可写入',
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
        noDeclaredSpec: '无安装声明',
        builtinSource: '随 DSH 提供',
        unknownSource: '来源未识别',
        installationSource: '随 DSH 安装提供',
        refusal: {
          'official-bundle': '随 DSH 提供，插件不替换。',
          'not-installed-here': '当前 profile 未安装该 bundle。',
          'not-installed': '未安装。',
          'no-declared-spec': '宿主没有记录安装声明。',
          'alias-substitution': '声明用别名指向另一个包，替换等于换包。',
          'name-substitution': '声明指向另一个包名，替换等于换包。',
          'range-with-scheme': '声明不是普通版本范围。',
          'no-installed-version': '读不到已安装版本。',
        },
        noNewerVersions: '没有更新的版本',
        notRegistrySource: (kind) => `来源是 ${kind}，插件不会替换。`,
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
        restoreOk: '已恢复到',
        restoreObserved: (version) => `当前实际版本 ${version ?? '未知'}`,
        restoreFilesMatched: '文件与快照记录的一致，没有发生变化。',
        operations: '最近操作',
        noOperations: '还没有操作记录',
        unresolved: '有未收尾的操作',
        loadActive: '已加载',
        loadFailed: '加载失败',
        loadPending: '待加载',
        loadLoading: '加载中',
        loadUnloading: '卸载中',
        loadUnknown: '未知',
        loadNoEntry: 'loader 里没有以这个包名注册的条目：bundle 是以 patch 方式展开成多个插件行的，行名不一定等于包名。这不代表它加载失败。',
        loadUnavailable: '这个进程里读不到 loader，所以无法判断加载状态。',
        compatOk: '满足',
        compatFail: '不满足',
        compatUnknown: '未知',
        compatNoRequirement: '未声明要求',
        compatExempted: '已豁免',
        compatUnmet: (requirements, runtime) => `当前宿主 ${runtime} 不满足：${requirements}`,
        compatMet: (requirements, runtime) => `当前宿主 ${runtime} 满足：${requirements}`,
        compatExemptedDetail: (runtime) => `版本不匹配（宿主 ${runtime}），但 profile 里有精确版本豁免`,
        compatNoClaim: '该包未声明 DSH 版本要求',
        runtimeSource: (source) => `来源：${source}`,
        errorLabel: '错误',
        notStarted: '尚未读取',
        started: '开始读取',
        requestFailed: (status) => `请求失败（HTTP ${status}）`,
        networkFailed: '无法连接到宿主接口',
        staleWarning: '这些数据来自上一次读取，可能已经过期',
        tabPlugins: '插件',
        tabSkills: 'Skill',
        skillsTitle: 'Skill 目录',
        skillsSubtitle: '宿主实际扫描到的 Skill；快照记录文件指纹与 Git 版本，Skill 本身没有版本号',
        skillsUnavailable: '这个宿主进程没有 skills 服务，因此无法列出 Skill。',
        skillsEmpty: '没有发现 Skill。',
        skillsIncomplete: '发现尚未完成，这个列表可能不完整。',
        skillsProvider: (provider) => `provider：${provider}`,
        skillColName: 'Skill',
        skillColSource: '来源',
        skillColFiles: '文件',
        skillColGit: 'Git',
        skillColSnapshots: '快照',
        skillColActions: '操作',
        skillSnapshot: '拍快照',
        skillSnapshotDone: (digest) => `已保存快照，指纹 ${digest}`,
        skillNoDirectory: '单文件 Skill，没有目录可复制',
        skillNoGit: '不在 Git 检出内',
        skillDirty: (count) => `${count} 处未提交改动`,
        skillClean: '无本地改动',
        skillSnapshotCount: (count) => `${count} 份`,
        skillRestore: '恢复',
        skillNoSnapshots: '还没有这个 Skill 的快照',
        skillUndoLabel: '撤销点',
        snapshotUnreadable: '读不出来',
        collapse: '收起',
        skillRestoreConfirm: '恢复这个快照？',
        skillRestoreBody: (name, taken) => `会把 ${name} 的目录内容替换成 ${taken} 那份快照记录的字节。`,
        skillRestoreNotes: [
          '替换前会先给当前目录拍一份快照，可以再恢复回来。',
          '只动这个 Skill 目录，不执行任何 Git 命令，也不改仓库其它内容。',
          '快照里没有的文件会被移走；这一步不能撤销，只能靠撤销快照再恢复。',
        ],
        skillRestoreDone: (taken) => `已恢复到 ${taken} 的快照`,
        skillRestorePreviewFailed: (reason) => `这个快照不能用来恢复：${reason}`,
        skillRestoreSameFiles: '目录内容与这份快照已经一致。',
        skillRestoreMoved: '目录内容已被改动，恢复会覆盖这些改动。',
        skillRestoreRefusals: {
          'no-directory': '单文件 Skill，没有目录可恢复。',
          'system-skill': '位于 .system 下，插件不写。',
          'inside-git-checkout': '位于 Git 检出内，插件不写。',
          'bundled-skill': '随 DSH 提供，插件不写。',
          'snapshot-unreadable': '快照文件读不出来。',
          'snapshot-mismatch': '快照记录的 Skill 不是这一个。',
          'snapshot-copy-missing': '快照的副本目录已不存在。',
          'snapshot-directory-mismatch': '快照记录的是另一个目录。',
          'snapshot-copy-corrupt': '快照副本的内容与指纹不符，不能作为基线。',
          'undo-snapshot-failed': '替换前的撤销快照没有拍成，已中止。',
          'staging-failed': '无法在同一个卷上准备新目录。',
          'staged-copy-corrupt': '准备出来的目录与快照不符，已中止。',
          'swap-failed': '目录替换失败，已尽量还原。',
          'verification-failed': '替换后校验不一致。',
          'bad-snapshot-file': '快照文件名不合法。',
          'not-a-directory': '目标不是目录。',
        },
        skillFilesTruncated: '超过上限，未数完',
        skillSourceLabels: {
          'project-dsh': '项目 .dsh/skills',
          'project-agents': '项目 .agents/skills',
          custom: '自定义目录',
          'user-dsh': '用户 .dsh/skills',
          'user-agents': '用户 .agents/skills',
          bundled: '随 DSH 提供',
        },
        skillSourceUnknown: (value) => `来源未识别（${value}）`,
        skillsSoon: 'Skill 版本管理在下一阶段提供；当前面板只处理插件。',
        gitTitle: 'Git 受管的 Skill',
        gitSubtitle:
          '登记一个远程仓库和它在仓库里的确切子路径，之后就能把某个 commit 的内容装进这个 Skill 目录。插件用自己的缓存读 Git，不在你的检出里跑任何命令。',
        gitEmpty: '还没有登记任何 Git 来源。',
        gitName: 'Skill 名',
        gitRemote: '仓库',
        gitSubpath: '仓库内子路径',
        gitRef: '分支或 tag',
        gitRegister: '登记',
        gitRegistering: '登记中…',
        gitRegisterNote: '登记只记录来源并钉住一个 commit，不改动目录里的文件。第一次更新才会把内容装进去。',
        gitNeedName: '先填 Skill 名',
        gitNeedRemote: '先填仓库地址',
        gitCreateHint: '宿主目录里没有这个 Skill 时，勾选后由插件创建 skills/<名字>。',
        gitCreate: '目录不存在时创建',
        gitRegisteredAt: (when) => `登记于 ${when}`,
        gitRevisionCurrent: '当前版本',
        gitPopulated: '已装入内容',
        gitNotPopulated: '尚未装入（目录还是空的）',
        gitLocalModifications: '目录里有登记之后的改动，更新会被拒绝',
        gitInCheckout: '目录在 Git 检出内，插件不写',
        gitHistory: '历史',
        gitPreview: '看看会变成什么',
        gitPreviewing: '读取中…',
        gitUpdate: '更新到最新',
        gitUpdating: '更新中…',
        gitRemove: '注销',
        gitRemoving: '注销中…',
        gitUpdateDone: (from, to) => `已更新 ${from} → ${to}`,
        gitRestoreTo: '回到这个 commit',
        gitRestored: (revision) => `已回到 ${revision}`,
        gitAlreadyAt: '已经是最新的 commit 了',
        gitChanges: (count) => `${count} 个文件会变`,
        gitNoChanges: '没有文件差异',
        gitUndoSnapshot: '替换前会先给当前目录拍快照，可以再回来。',
        gitUpdateConfirm: '把这个 Skill 更新到这个 commit？',
        gitUpdateBody: (name, from, to) => `会把 ${name} 的目录内容替换成 ${to}。当前是 ${from}。`,
        gitUpdateNotes: [
          '替换前先拍快照，可撤销。',
          '目录里不在这个 commit 中的文件会被移走。',
          '不执行 checkout、reset、clean，也不碰仓库本身。',
        ],
        gitRestoreConfirm: '把这个 Skill 退回这个 commit？',
        gitRestoreBody: (name, revision) => `会把 ${name} 的目录内容替换成 ${revision} 的树。`,
        gitGitRefusals: {
          'not-registered': '这个 Skill 没有登记 Git 来源。',
          'unsupported-remote': '这个仓库地址不是插件支持的传输方式。',
          'bad-subpath': '子路径不合法（不能是绝对路径、不能含 .. 或 .git）。',
          'no-directory': '单文件 Skill，没有目录可写。',
          'system-skill': '位于 .system 下，插件不写。',
          'inside-git-checkout': '目录在 Git 检出内，插件不写。',
          'local-modifications': '目录里有登记之后的改动，先处理这些改动再更新。',
          'baseline-unknown': '目录里已有的文件与这个 commit 的树不一致，无法给出诚实的基线。',
          'already-registered': '这个 Skill 已经登记了另一个来源；先注销再登记。',
          'missing-name': '缺少 Skill 名。',
          'bad-name': 'Skill 名只能包含字母、数字、点、横线和下划线。',
          'git-not-found': '找不到 git 命令。',
          'git-timeout': 'Git 命令超时。',
          'fetch-failed': '拉取仓库失败，检查地址和网络。',
          'ref-unresolved': '这个分支或 tag 解析不出 commit。',
          'revision-not-in-cache': '缓存里没有这个 commit，插件不猜。',
          'unsupported-entry': '这个 commit 里有符号链接或子模块，插件不写。',
          'already-at-revision': '已经在这个 commit 上。',
          'undo-snapshot-failed': '替换前的快照没有拍成，已中止。',
          'bad-revision': 'commit 号不合法。',
        },
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
        counts: (total, writable, official, unsatisfied, unknownCompat) => {
          const base = `${total} entries, ${writable} writable, ${official} official`
          const parts = []
          if (unsatisfied > 0) parts.push(`${unsatisfied} incompatible with this host`)
          if (unknownCompat > 0) parts.push(`${unknownCompat} with undecidable compatibility`)
          return parts.length === 0 ? base : `${base}, ${parts.join(', ')}`
        },
        filterAll: 'All',
        filterWritable: 'Writable',
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
        noDeclaredSpec: 'no declared spec',
        builtinSource: 'ships with DSH',
        unknownSource: 'source not recognised',
        installationSource: 'from the DSH installation',
        refusal: {
          'official-bundle': 'Ships with DSH, so this panel never replaces it.',
          'not-installed-here': 'Not installed in this profile.',
          'not-installed': 'Not installed.',
          'no-declared-spec': 'The host records no declared spec.',
          'alias-substitution': 'The spec aliases another package, so replacing it would swap packages.',
          'name-substitution': 'The spec names another package, so replacing it would swap packages.',
          'range-with-scheme': 'The spec is not a plain version range.',
          'no-installed-version': 'The installed version could not be read.',
        },
        noNewerVersions: 'No newer versions',
        notRegistrySource: (kind) => `Installed from a ${kind} source, so this panel never replaces it.`,
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
  restoreOk: 'Restored to',
  restoreObserved: (version) => `now on disk: ${version ?? 'unknown'}`,
  restoreFilesMatched: 'The files still match what the snapshot recorded.',
        operations: 'Recent operations',
        noOperations: 'No operations recorded',
        unresolved: 'An operation has not settled',
        loadActive: 'active',
        loadFailed: 'failed',
        loadPending: 'pending',
        loadLoading: 'loading',
        loadUnloading: 'unloading',
        loadUnknown: 'unknown',
        loadNoEntry: 'No loader entry is registered under this package name: a bundle expands into plugin rows through its patch, so a row name need not equal the package name. That is not a load failure.',
        loadUnavailable: 'The loader cannot be read in this process, so the load state is unknown.',
        compatOk: 'met',
        compatFail: 'not met',
        compatUnknown: 'unknown',
        compatNoRequirement: 'no requirement',
        compatExempted: 'exempted',
        compatUnmet: (requirements, runtime) => `Host ${runtime} does not satisfy ${requirements}`,
        compatMet: (requirements, runtime) => `Host ${runtime} satisfies ${requirements}`,
        compatExemptedDetail: (runtime) => `Version mismatch (host ${runtime}), but the profile has an exact-version exemption`,
        compatNoClaim: 'This package declares no DSH version requirement',
        runtimeSource: (source) => `from ${source}`,
        errorLabel: 'Error',
        notStarted: 'Not read yet',
        started: 'Read started',
        requestFailed: (status) => `Request failed (HTTP ${status})`,
        networkFailed: 'Could not reach the host route',
        staleWarning: 'This data came from an earlier read and may be out of date',
        tabPlugins: 'Plugins',
        tabSkills: 'Skills',
        skillsTitle: 'Skill directories',
        skillsSubtitle:
          'The skills this host actually scanned; a snapshot records file fingerprints and a Git revision, because a skill has no version number',
        skillsUnavailable: 'This host process has no skills service, so skills cannot be listed.',
        skillsEmpty: 'No skills were found.',
        skillsIncomplete: 'Discovery has not finished, so this list may be incomplete.',
        skillsProvider: (provider) => `provider: ${provider}`,
        skillColName: 'Skill',
        skillColSource: 'Source',
        skillColFiles: 'Files',
        skillColGit: 'Git',
        skillColSnapshots: 'Snapshots',
        skillColActions: 'Actions',
        skillSnapshot: 'Snapshot',
        skillSnapshotDone: (digest) => `Snapshot saved, fingerprint ${digest}`,
        skillNoDirectory: 'A single-file skill has no directory to copy',
        skillNoGit: 'Not inside a Git checkout',
        skillDirty: (count) => `${count} uncommitted changes`,
        skillClean: 'No local changes',
        skillSnapshotCount: (count) => `${count}`,
        skillRestore: 'Restore',
        skillNoSnapshots: 'No snapshot of this skill yet',
        skillUndoLabel: 'undo point',
        snapshotUnreadable: 'unreadable',
        collapse: 'Collapse',
        skillRestoreConfirm: 'Restore this snapshot?',
        skillRestoreBody: (name, taken) =>
          `The ${name} directory is replaced with the exact bytes recorded in the ${taken} snapshot.`,
        skillRestoreNotes: [
          'The current directory is snapshotted first, so this step can itself be undone.',
          'Only that skill directory is touched. No Git command runs and the rest of the repository is left alone.',
          'Files that were added after the snapshot are removed. That is not reversible except by restoring the undo snapshot.',
        ],
        skillRestoreDone: (taken) => `Restored to the snapshot from ${taken}`,
        skillRestorePreviewFailed: (reason) => `This snapshot cannot be used to restore: ${reason}`,
        skillRestoreSameFiles: 'The directory already matches this snapshot.',
        skillRestoreMoved: 'The directory changed since this snapshot; a restore would replace those changes.',
        skillRestoreRefusals: {
          'no-directory': 'This is a single-file skill, so there is no directory to restore.',
          'system-skill': 'It lives under .system, which this plugin never writes.',
          'inside-git-checkout': 'It lives inside a Git checkout, which this plugin never writes.',
          'bundled-skill': 'It ships with DSH, which this plugin never writes.',
          'snapshot-unreadable': 'The snapshot file could not be read.',
          'snapshot-mismatch': 'The snapshot records a different skill.',
          'snapshot-copy-missing': 'The stored copy is gone.',
          'snapshot-directory-mismatch': 'The snapshot records a different directory.',
          'snapshot-copy-corrupt': 'The stored copy no longer matches its fingerprint, so it is not a baseline.',
          'undo-snapshot-failed': 'The undo snapshot could not be taken, so nothing was replaced.',
          'staging-failed': 'A staging directory could not be prepared on the same volume.',
          'staged-copy-corrupt': 'The staged copy did not match the snapshot, so nothing was swapped in.',
          'swap-failed': 'The directory swap failed and the original was put back where possible.',
          'verification-failed': 'The directory did not match the snapshot after the swap.',
          'bad-snapshot-file': 'That snapshot file name is not valid.',
          'not-a-directory': 'The target is not a directory.',
        },
        skillFilesTruncated: 'over the limit, not counted to the end',
        skillSourceLabels: {
          'project-dsh': 'project .dsh/skills',
          'project-agents': 'project .agents/skills',
          custom: 'custom directories',
          'user-dsh': 'user .dsh/skills',
          'user-agents': 'user .agents/skills',
          bundled: 'bundled with DSH',
        },
        skillSourceUnknown: (value) => `unrecognised source (${value})`,
        skillsSoon:
          'Skill version management comes in the next stage; this panel handles plugins only.',
        gitTitle: 'Git-managed Skills',
        gitSubtitle:
          'Register a remote repository and the exact subpath inside it, and this Skill can then be filled from a commit. The plugin reads Git through its own cache and never runs a command inside your checkout.',
        gitEmpty: 'No Git source is registered yet.',
        gitName: 'Skill name',
        gitRemote: 'Repository',
        gitSubpath: 'Subpath in the repository',
        gitRef: 'Branch or tag',
        gitRegister: 'Register',
        gitRegistering: 'Registering…',
        gitRegisterNote:
          'Registering records the source and pins one commit; it does not touch the files. The first update is what writes them.',
        gitNeedName: 'Enter a Skill name first',
        gitNeedRemote: 'Enter a repository first',
        gitCreateHint: 'When the host catalog has no such Skill, this lets the plugin create skills/<name>.',
        gitCreate: 'Create the directory when missing',
        gitRegisteredAt: (when) => `registered ${when}`,
        gitRevisionCurrent: 'Current revision',
        gitPopulated: 'Content is installed',
        gitNotPopulated: 'Nothing installed yet (the directory is empty)',
        gitLocalModifications: 'The directory changed since registration, so an update is refused',
        gitInCheckout: 'The directory is inside a Git checkout, which this plugin never writes',
        gitHistory: 'History',
        gitPreview: 'Preview the change',
        gitPreviewing: 'Reading…',
        gitUpdate: 'Update to latest',
        gitUpdating: 'Updating…',
        gitRemove: 'Unregister',
        gitRemoving: 'Unregistering…',
        gitUpdateDone: (from, to) => `Updated ${from} → ${to}`,
        gitRestoreTo: 'Go back to this commit',
        gitRestored: (revision) => `Back at ${revision}`,
        gitAlreadyAt: 'Already at the newest commit',
        gitChanges: (count) => `${count} file${count === 1 ? '' : 's'} would change`,
        gitNoChanges: 'No file differences',
        gitUndoSnapshot: 'The current directory is snapshotted first, so this can be undone.',
        gitUpdateConfirm: 'Update this Skill to that commit?',
        gitUpdateBody: (name, from, to) => `The ${name} directory is replaced with ${to}. It is at ${from} now.`,
        gitUpdateNotes: [
          'A snapshot of the current directory is taken first, so this can be undone.',
          'Files that are not in that commit are removed from the directory.',
          'No checkout, reset or clean runs, and the repository itself is not touched.',
        ],
        gitRestoreConfirm: 'Put this Skill back at that commit?',
        gitRestoreBody: (name, revision) => `The ${name} directory is replaced with the tree of ${revision}.`,
        gitGitRefusals: {
          'not-registered': 'This Skill has no registered Git source.',
          'unsupported-remote': 'That repository address uses a transport this plugin does not support.',
          'bad-subpath': 'That subpath is not valid (no absolute path, no .. and no .git).',
          'no-directory': 'A single-file skill has no directory to write.',
          'system-skill': 'It lives under .system, which this plugin never writes.',
          'inside-git-checkout': 'The directory is inside a Git checkout, which this plugin never writes.',
          'local-modifications': 'The directory changed after registration; settle those changes before updating.',
          'baseline-unknown': 'What is in the directory does not match that commit tree, so there is no honest baseline.',
          'already-registered': 'This Skill is already registered to another source; unregister it first.',
          'missing-name': 'A Skill name is required.',
          'bad-name': 'A Skill name may only contain letters, digits, dot, dash and underscore.',
          'git-not-found': 'The git command was not found.',
          'git-timeout': 'A Git command timed out.',
          'fetch-failed': 'Fetching the repository failed; check the address and the network.',
          'ref-unresolved': 'That branch or tag does not resolve to a commit.',
          'revision-not-in-cache': 'That commit is not in the cache, and this plugin does not guess.',
          'unsupported-entry': 'That commit contains a symlink or a submodule, which this plugin does not write.',
          'already-at-revision': 'It is already at that commit.',
          'undo-snapshot-failed': 'The undo snapshot could not be taken, so nothing was replaced.',
          'bad-revision': 'That commit id is not valid.',
        },
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

    /**
     * The sentence behind a load badge.
     *
     * A bundle is applied as a patch, so the loader tracks the plugin entries it
     * installs rather than the bundle name. "No phase" therefore means "this
     * composition is not an entry", which is not the same as "the loader could
     * not be read", and neither means the plugin is broken.
     */
    function loadDetail(row, t) {
      if (row.loadState === 'failed') return row.loadError ?? null
      if (row.loadStateReason === 'no-loader-entry') return t.loadNoEntry
      if (row.loadStateAvailable !== true) return t.loadUnavailable
      if (row.loadState === null || row.loadState === undefined) return t.loadNoEntry
      return null
    }

    function compatLabel(row, t) {
      const compat = row.compatibility ?? {}
      const verdict = compat.verdict
      if (verdict === undefined || verdict === null || verdict === 'unknown') return t.compatUnknown
      if (verdict === 'exempted') return t.compatExempted
      if (verdict === 'satisfied' || verdict === 'met' || verdict === 'ok') {
        // "satisfied" with no requirement means the package asked for nothing,
        // which is not the same as the host having checked it.
        const declared = Array.isArray(compat.requirements) && compat.requirements.length > 0
        return declared ? t.compatOk : t.compatNoRequirement
      }
      return t.compatFail
    }

    function compatTone(row) {
      const compat = row.compatibility ?? {}
      const verdict = compat.verdict
      if (verdict === 'satisfied' || verdict === 'met' || verdict === 'ok') {
        // Nothing was declared, so nothing was verified: a neutral dot, never a
        // green one, keeps the badge from implying a check that never happened.
        const declared = Array.isArray(compat.requirements) && compat.requirements.length > 0
        return declared ? 'pass' : 'idle'
      }
      if (verdict === 'exempted') return 'warn'
      if (verdict === undefined || verdict === null || verdict === 'unknown') return 'idle'
      return 'fail'
    }

    /**
     * The sentence behind a compatibility badge.
     *
     * A badge is a claim, so it always has a reason attached: the requirement
     * that failed, the range this panel could not read, or the fact that the
     * running DSH version was not observable at all.
     */
    function compatDetail(row, t) {
      const compat = row.compatibility ?? {}
      if (compat.verdict === 'unsatisfied' && Array.isArray(compat.unmet) && compat.unmet.length > 0) {
        const parts = compat.unmet.map((item) => `${item.field} ${item.range}`)
        return t.compatUnmet(parts.join('; '), compat.runtimeVersion ?? t.unknown)
      }
      if (compat.verdict === 'exempted') return t.compatExemptedDetail(compat.runtimeVersion ?? t.unknown)
      if (compat.reason) return String(compat.reason)
      if (Array.isArray(compat.requirements) && compat.requirements.length > 0) {
        const parts = compat.requirements.map((item) => `${item.field} ${item.range}`)
        return t.compatMet(parts.join('; '), compat.runtimeVersion ?? t.unknown)
      }
      return t.compatNoClaim
    }

    function sourceLabel(row, t) {
      const source = row.source ?? {}
      if (source.kind === 'builtin') return t.builtinSource
      if (row.availability === 'installation') return t.installationSource
      if (source.kind === 'unknown') return t.unknownSource
      if (typeof source.detail === 'string' && source.detail !== '') return source.detail
      if (source.kind === 'registry') return source.registryName ?? t.unknown
      return source.kind ?? t.unknown
    }

    // Refusals arrive as reason codes so the sentence can be written here, in
    // the reader's language, instead of being rendered in English.
    function refusalLabel(reason, t) {
      if (typeof reason !== 'string') return null
      if (reason.startsWith('read-only:')) return `${t.readOnly} (${reason.slice('read-only:'.length)})`
      if (reason.startsWith('not-registry:')) {
        return t.notRegistrySource(reason.slice('not-registry:'.length))
      }
      return t.refusal[reason] ?? reason
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
          // A restore is a different fact from an update: it reinstalls the
          // version the snapshot recorded. Saying "updated" here would be a
          // wrong verb for what happened.
          const moved = body.evidence?.filesMatch === false
          setResult({
            ok: body.ok === true,
            message:
              body.ok === true
                ? `${t.restoreOk}: ${body.fromVersion ?? ''}${body.fromVersion ? ' → ' : ''}${body.restoredVersion}（${t.restoreObserved(body.observedVersion)}）${moved ? '' : ` ${t.restoreFilesMatched}`}`
                : `${t.updateFailed}: ${body.message ?? ''}`,
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

      // Not "updatable": the host accepting a write says nothing about whether
      // a newer version exists. Only the version check answers that.
      const writable = row.updateRefusal === null

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
            writable ? null : h(Badge, null, t.readOnly),
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
          { style: { padding: '6px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' } },
          h(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'nowrap' } },
            h(
              Button,
              {
                onClick: loadVersions,
                disabled: !writable || versionsBusy,
                title: writable ? undefined : refusalLabel(row.updateRefusal, t) ?? '',
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
              h(Field, {
                // The badge says "unknown" for an entry the loader never had; the
                // sentence has to say why, or the user reads it as broken.
                label: t.colLoad,
                value: loadDetail(row, t) === null ? loadLabel(row, t) : `${loadLabel(row, t)} — ${loadDetail(row, t)}`,
              }),
              row.loadError === null || row.loadError === undefined
                ? null
                : h(Field, { label: t.errorLabel, value: row.loadError }),
              h(Field, {
                // The compatibility badge is a claim, so the row carries the
                // sentence behind it: which requirement failed, or why this
                // panel could not decide.
                label: t.colCompat,
                value: compatDetail(row, t),
              }),
              row.updateRefusal === null
                ? null
                : h(Field, { label: t.readOnly, value: refusalLabel(row.updateRefusal, t) }),

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

    function skillSourceLabel(source, t) {
      if (source === null || source === undefined) return t.unknown
      const known = t.skillSourceLabels?.[source]
      return known ?? t.skillSourceUnknown(source)
    }

    function skillGitLabel(skill, t) {
      const git = skill.git
      if (git === null || git === undefined) return t.skillNoGit
      if (git.managed !== true) return t.skillNoGit
      const parts = []
      if (git.revision) parts.push(git.revision)
      if (git.dirty === true) parts.push(t.skillDirty(git.changes ?? 0))
      else if (git.dirty === false) parts.push(t.skillClean)
      return parts.length === 0 ? t.skillNoGit : parts.join(' · ')
    }

    /**
     * One stored snapshot as a row the user can act on: preview it, then restore
     * it. The preview runs before the confirmation bar so a refusal is read while
     * choosing, not after committing.
     */
    function SkillSnapshotList(props) {
      const { skill, t, language, onTake } = props
      const snapshots = skill.snapshots ?? []
      const [openFile, setOpenFile] = useState(null)
      const [preview, setPreview] = useState(null)
      const [previewError, setPreviewError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [done, setDone] = useState(null)
      const refusal = skill.restoreRefusal ?? null

      if (snapshots.length === 0) return h('div', { style: { fontSize: 11, opacity: 0.65 } }, t.skillNoSnapshots)

      const openPreview = async (snapshot) => {
        setOpenFile(snapshot.file)
        setPreview(null)
        setPreviewError(null)
        setDone(null)
        try {
          const result = await request(
            `/skills/restore-preview?name=${encodeURIComponent(skill.name)}&file=${encodeURIComponent(snapshot.file)}`,
          )
          setPreview(result)
        } catch (failure) {
          setPreviewError(describeError(failure, t))
        }
      }

      const runRestore = async (snapshot) => {
        setBusy(true)
        setPreviewError(null)
        try {
          const result = await request('/skills/restore', {
            method: 'POST',
            body: { name: skill.name, file: snapshot.file, confirm: true },
          })
          setDone(t.skillRestoreDone(formatTime(result.restoredTo, language)))
          setOpenFile(null)
          setPreview(null)
          if (typeof onTake === 'function') onTake()
        } catch (failure) {
          setPreviewError(describeError(failure, t))
        } finally {
          setBusy(false)
        }
      }

      const describe = (reason) =>
        t.skillRestoreRefusals[String(reason)] ?? String(reason ?? '')

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 } },
        snapshots.slice(0, 5).map((snapshot) =>
          h(
            'div',
            { key: snapshot.file, style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
            h(
              'span',
              { style: { fontSize: 11.5, opacity: 0.8 } },
              formatTime(snapshot.takenAt, language),
              snapshot.reason === 'before-restore' ? h(Badge, null, t.skillUndoLabel) : null,
              snapshot.unreadable === true ? h(Badge, null, t.snapshotUnreadable) : null,
            ),
            snapshot.unreadable === true || snapshot.digest === null
              ? null
              : h(
                  Button,
                  {
                    onClick: () => (openFile === snapshot.file ? setOpenFile(null) : openPreview(snapshot)),
                    disabled: refusal !== null || busy,
                    title: refusal === null ? undefined : describe(refusal),
                    small: true,
                  },
                  openFile === snapshot.file ? t.collapse : t.skillRestore,
                ),
          ),
        ),
        done === null ? null : h('div', { style: { fontSize: 11.5 } }, done),
        previewError === null
          ? null
          : h('div', { role: 'alert', style: { fontSize: 11.5 } }, previewError),
        openFile === null
          ? null
          : preview === null
            ? h('div', { style: { fontSize: 11.5, opacity: 0.7 } }, t.loading)
            : preview.ok !== true
              ? h(
                  'div',
                  { role: 'alert', style: { fontSize: 11.5 } },
                  t.skillRestorePreviewFailed(describe(preview.reason)),
                )
              : h(
                  'div',
                  { style: { marginTop: 2 } },
                  h(
                    'div',
                    { style: { fontSize: 11.5, opacity: 0.8 } },
                    preview.detail?.sameFiles === true ? t.skillRestoreSameFiles : t.skillRestoreMoved,
                  ),
                  h(ConfirmBar, {
                    t,
                    title: t.skillRestoreConfirm,
                    body: t.skillRestoreBody(
                      skill.name,
                      formatTime(preview.detail?.takenAt ?? null, language),
                    ),
                    notes: t.skillRestoreNotes,
                    busy,
                    confirmLabel: t.skillRestore,
                    onCancel: () => setOpenFile(null),
                    onConfirm: () => runRestore(snapshots.find((entry) => entry.file === openFile)),
                  }),
                ),
      )
    }

    function SkillRow(props) {
      const { skill, t, language, onTake } = props
      const [pending, setPending] = useState(false)
      const [message, setMessage] = useState(null)
      const [error, setError] = useState(null)
      const [expanded, setExpanded] = useState(false)
      const snapshots = skill.snapshots ?? []
      const refusal = skill.restoreRefusal ?? null

      const runSnapshot = async () => {
        setPending(true)
        setError(null)
        setMessage(null)
        try {
          const result = await request('/skills/snapshot', {
            method: 'POST',
            body: { name: skill.name, confirm: true },
          })
          const digest = String(result.snapshot?.digest ?? '').slice(0, 12)
          setMessage(t.skillSnapshotDone(digest))
          if (typeof onTake === 'function') onTake()
        } catch (failure) {
          setError(describeError(failure, t))
        } finally {
          setPending(false)
        }
      }

      return h(
        'tr',
        { style: { borderTop: `1px solid ${COLORS.line}`, verticalAlign: 'top' } },
        h(
          'td',
          { style: { padding: '6px 8px' } },
          h('div', { style: { fontWeight: 500 } }, skill.name),
          skill.description === null
            ? null
            : h(
                'div',
                { style: { fontSize: 11, opacity: 0.65, maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                skill.description,
              ),
          message === null ? null : h('div', { style: { fontSize: 11, marginTop: 2 } }, message),
          error === null ? null : h('div', { role: 'alert', style: { fontSize: 11, marginTop: 2 } }, error),
          expanded === true
            ? h(SkillSnapshotList, { skill, t, language, onTake })
            : null,
        ),
        h('td', { style: { padding: '6px 8px', fontSize: 12 } }, skillSourceLabel(skill.source, t)),
        h(
          'td',
          { style: { padding: '6px 8px', fontSize: 12, whiteSpace: 'nowrap' } },
          skill.fileCount === null ? '—' : String(skill.fileCount),
          skill.fileCountTruncated === true ? h(Badge, null, t.skillFilesTruncated) : null,
        ),
        h(
          'td',
          { style: { padding: '6px 8px', fontSize: 12, whiteSpace: 'nowrap' } },
          skillGitLabel(skill, t),
        ),
        h(
          'td',
          { style: { padding: '6px 8px', fontSize: 12, whiteSpace: 'nowrap' } },
          snapshots.length === 0
            ? '—'
            : h(
                Button,
                { onClick: () => setExpanded(!expanded), small: true },
                t.skillSnapshotCount(snapshots.length),
                expanded === true ? ' ▲' : ' ▼',
              ),
          snapshots.length === 0
            ? null
            : h(
                'div',
                { style: { fontSize: 11, opacity: 0.65 } },
                formatTime(snapshots[0].takenAt, language),
              ),
        ),
        h(
          'td',
          { style: { padding: '6px 8px', whiteSpace: 'nowrap' } },
          h(
            Button,
            {
              onClick: runSnapshot,
              disabled: pending === true || skill.directory === null,
              title: skill.directory === null ? t.skillNoDirectory : refusal === null ? undefined : t.skillRestoreRefusals[refusal] ?? refusal,
            },
            pending ? t.refreshing : t.skillSnapshot,
          ),
        ),
      )
    }

    function gitRefusalLabel(reason, t) {
      if (reason === null || reason === undefined) return ''
      return t.gitGitRefusals[String(reason)] ?? String(reason)
    }

    /**
     * A refusal from the Git half arrives as an HTTP error with a reason code in
     * the body. Showing "HTTP 409" would hide the only part the reader can act
     * on, so the code is translated first and the generic text is the fallback.
     */
    function describeGitFailure(error, t) {
      const code = error?.body?.error
      if (typeof code === 'string' && t.gitGitRefusals[code] !== undefined) {
        return t.gitGitRefusals[code]
      }
      return describeError(error, t)
    }

    /**
     * The form that records where a Skill comes from.
     *
     * Registering writes one line to a registry file. It deliberately does not
     * download anything: a claim about intent should not be able to destroy
     * content, so the files move only when the user asks for an update.
     */
    function GitRegisterForm(props) {
      const { t, onRegistered } = props
      const [name, setName] = useState('')
      const [remote, setRemote] = useState('')
      const [subpath, setSubpath] = useState('')
      const [ref, setRef] = useState('')
      const [create, setCreate] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)

      const submit = async (event) => {
        if (event !== undefined && typeof event.preventDefault === 'function') event.preventDefault()
        if (name.trim() === '') {
          setError(t.gitNeedName)
          return
        }
        if (remote.trim() === '') {
          setError(t.gitNeedRemote)
          return
        }
        setBusy(true)
        setError(null)
        try {
          await request('/skills/git/register', {
            method: 'POST',
            body: {
              name: name.trim(),
              remote: remote.trim(),
              subpath: subpath.trim(),
              ref: ref.trim(),
              create,
              confirm: true,
            },
          })
          setName('')
          setRemote('')
          setSubpath('')
          setRef('')
          setCreate(false)
          if (typeof onRegistered === 'function') onRegistered()
        } catch (failure) {
          setError(describeGitFailure(failure, t))
        } finally {
          setBusy(false)
        }
      }

      const input = (value, onChange, placeholder) =>
        h('input', {
          type: 'text',
          value,
          placeholder,
          'aria-label': placeholder,
          onChange: (event) => onChange(event.target.value),
          style: {
            font: 'inherit',
            fontSize: 12,
            padding: '3px 8px',
            borderRadius: 6,
            border: `1px solid ${COLORS.line}`,
            background: 'transparent',
            color: 'inherit',
            minWidth: 150,
            flex: '1 1 150px',
          },
        })

      return h(
        'form',
        { onSubmit: submit, style: { marginTop: 10 } },
        h('div', { style: { fontSize: 13, fontWeight: 600 } }, t.gitTitle),
        h('div', { style: { fontSize: 12, opacity: 0.7, marginTop: 2, maxWidth: 720 } }, t.gitSubtitle),
        h(
          'div',
          { style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' } },
          input(name, setName, t.gitName),
          input(remote, setRemote, t.gitRemote),
          input(subpath, setSubpath, t.gitSubpath),
          input(ref, setRef, t.gitRef),
          h(Button, { onClick: submit, disabled: busy === true, primary: true }, busy === true ? t.gitRegistering : t.gitRegister),
        ),
        h(
          'label',
          { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5, marginTop: 6, opacity: 0.8 } },
          h('input', { type: 'checkbox', checked: create, onChange: (event) => setCreate(event.target.checked) }),
          t.gitCreate,
          h('span', { style: { opacity: 0.7 } }, `— ${t.gitCreateHint}`),
        ),
        h('div', { style: { fontSize: 11.5, opacity: 0.65, marginTop: 4, maxWidth: 720 } }, t.gitRegisterNote),
        error === null ? null : h('div', { role: 'alert', style: { fontSize: 11.5, marginTop: 4 } }, error),
      )
    }

    /**
     * One registered Skill: where it comes from, what it is at, and the three
     * things a user may do — look, move forward, move back.
     */
    function GitSkillRow(props) {
      const { row, t, language, onChanged } = props
      const [preview, setPreview] = useState(null)
      const [previewBusy, setPreviewBusy] = useState(false)
      const [pending, setPending] = useState(null)
      const [busyKind, setBusyKind] = useState(null)
      const [message, setMessage] = useState(null)
      const [error, setError] = useState(null)
      const [showHistory, setShowHistory] = useState(false)

      const history = row.history ?? []
      const refusal = row.refusal ?? null
      const restoreRefusal = row.restoreRefusal ?? null

      const runPreview = async () => {
        setPreviewBusy(true)
        setError(null)
        setMessage(null)
        try {
          const body = await request('/skills/git/preview', {
            method: 'POST',
            body: { name: row.name, confirm: true },
          })
          setPreview(body)
          if (body.ok !== true) setError(gitRefusalLabel(body.reason, t))
          return body
        } catch (failure) {
          setError(describeGitFailure(failure, t))
          return null
        } finally {
          setPreviewBusy(false)
        }
      }

      const apply = async (kind, revision) => {
        setBusyKind(kind)
        setError(null)
        setMessage(null)
        try {
          const path = kind === 'update' ? '/skills/git/update' : '/skills/git/restore'
          const body = await request(path, {
            method: 'POST',
            body: revision === null ? { name: row.name, confirm: true } : { name: row.name, revision, confirm: true },
          })
          if (body.ok === true) {
            setMessage(
              kind === 'update'
                ? t.gitUpdateDone(String(body.fromRevision ?? '').slice(0, 7), String(body.toRevision ?? '').slice(0, 7))
                : t.gitRestored(String(body.toRevision ?? '').slice(0, 7)),
            )
          } else if (body.error === 'already-at-revision') {
            setMessage(t.gitAlreadyAt)
          } else {
            setError(gitRefusalLabel(body.error, t))
          }
          setPending(null)
          setPreview(null)
          if (typeof onChanged === 'function') onChanged()
        } catch (failure) {
          setError(describeGitFailure(failure, t))
          setPending(null)
        } finally {
          setBusyKind(null)
        }
      }

      const remove = async () => {
        setBusyKind('remove')
        setError(null)
        setMessage(null)
        try {
          await request('/skills/git/remove', { method: 'POST', body: { name: row.name, confirm: true } })
          if (typeof onChanged === 'function') onChanged()
        } catch (failure) {
          setError(describeGitFailure(failure, t))
        } finally {
          setBusyKind(null)
        }
      }

      const stateBadge =
        row.localModifications === true
          ? h(Badge, null, t.gitLocalModifications)
          : row.inCheckout === true
            ? h(Badge, null, t.gitInCheckout)
            : row.populated === false
              ? h(Badge, null, t.gitNotPopulated)
              : h(Badge, null, t.gitPopulated)

      const revisionLine = h(
        'div',
        { style: { fontSize: 11.5, opacity: 0.75, marginTop: 2, wordBreak: 'break-all' } },
        `${t.gitRevisionCurrent}: `,
        h('code', { style: { fontFamily: 'ui-monospace, monospace' } }, String(row.revision ?? '').slice(0, 12) || '—'),
        row.revisionSubject === null || row.revisionSubject === undefined ? '' : ` · ${row.revisionSubject}`,
      )

      const sourceLine = h(
        'div',
        { style: { fontSize: 11, opacity: 0.65, marginTop: 2, wordBreak: 'break-all' } },
        `${row.remote}${row.subpath === '' ? '' : `#${row.subpath}`} · ${row.ref}`,
        row.registeredAt === null ? '' : ` · ${t.gitRegisteredAt(formatTime(row.registeredAt, language))}`,
      )

      return h(
        'div',
        { style: { borderTop: `1px solid ${COLORS.line}`, padding: '8px 0' } },
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
          h('span', { style: { fontWeight: 500 } }, row.name),
          stateBadge,
          refusal === null ? null : h(Badge, null, gitRefusalLabel(refusal, t)),
        ),
        revisionLine,
        sourceLine,
        message === null ? null : h('div', { style: { fontSize: 11.5, marginTop: 3 } }, message),
        error === null ? null : h('div', { role: 'alert', style: { fontSize: 11.5, marginTop: 3 } }, error),
        h(
          'div',
          { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
          h(
            Button,
            { onClick: runPreview, disabled: previewBusy === true || busyKind !== null, small: true },
            previewBusy === true ? t.gitPreviewing : t.gitPreview,
          ),
          h(
            Button,
            {
              // The confirmation names the commit it will move to, so the preview
              // is fetched first and the bar only appears when there is something
              // to apply. The server re-checks before writing, so this is about
              // saying the right thing, not about trusting the client.
              onClick: async () => {
                const body = await runPreview()
                if (body?.ok === true && body.detail?.alreadyAtRevision !== true) {
                  setPending({ kind: 'update' })
                }
              },
              disabled: busyKind !== null || refusal !== null,
              title: refusal === null ? undefined : gitRefusalLabel(refusal, t),
              small: true,
            },
            busyKind === 'update' ? t.gitUpdating : t.gitUpdate,
          ),
          history.length === 0
            ? null
            : h(
                Button,
                { onClick: () => setShowHistory(!showHistory), small: true },
                `${t.gitHistory} (${history.length})`,
                showHistory === true ? ' ▲' : ' ▼',
              ),
          h(
            Button,
            { onClick: remove, disabled: busyKind !== null, small: true },
            busyKind === 'remove' ? t.gitRemoving : t.gitRemove,
          ),
        ),
        showHistory === true
          ? h(
              'div',
              { style: { marginTop: 6 } },
              history.map((item) =>
                h(
                  'div',
                  {
                    key: item.revision,
                    style: { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5, padding: '2px 0' },
                  },
                  h('code', { style: { fontFamily: 'ui-monospace, monospace' } }, item.revision.slice(0, 7)),
                  h('span', { style: { opacity: 0.75 } }, item.subject ?? ''),
                  item.revision === row.revision ? h(Badge, null, t.gitRevisionCurrent) : null,
                  h('span', { style: { opacity: 0.6 } }, formatTime(item.at, language)),
                  item.revision === row.revision
                    ? null
                    : h(
                        'span',
                        { style: { marginLeft: 'auto' } },
                        h(
                          Button,
                          {
                            onClick: () => setPending({ kind: 'restore', revision: item.revision }),
                            // A restore snapshots first and then replaces the tree,
                            // so it stays available when the directory was edited
                            // by hand -- that is exactly when it is needed. Its own
                            // narrower refusal decides (see restoreRefusal).
                            disabled: busyKind !== null || restoreRefusal !== null,
                            title: restoreRefusal === null ? undefined : gitRefusalLabel(restoreRefusal, t),
                            small: true,
                          },
                          t.gitRestoreTo,
                        ),
                      ),
                ),
              ),
            )
          : null,
        preview === null
          ? null
          : preview.ok !== true
            ? h('div', { role: 'alert', style: { fontSize: 11.5, marginTop: 4 } }, gitRefusalLabel(preview.reason, t))
            : h(
                'div',
                { style: { marginTop: 4, fontSize: 11.5 } },
                h(
                  'div',
                  { style: { opacity: 0.8 } },
                  preview.detail?.alreadyAtRevision === true
                    ? t.gitAlreadyAt
                    : preview.detail?.changeCount === 0
                      ? t.gitNoChanges
                      : t.gitChanges(preview.detail?.changeCount ?? 0),
                ),
                (preview.detail?.changes ?? []).slice(0, 12).map((change) =>
                  h(
                    'div',
                    { key: `${change.status} ${change.path}`, style: { display: 'flex', gap: 6, opacity: 0.75 } },
                    h('span', { style: { fontFamily: 'ui-monospace, monospace', minWidth: 18 } }, change.status),
                    h('span', { style: { wordBreak: 'break-all' } }, change.path),
                  ),
                ),
              ),
        pending === null
          ? null
          : h(ConfirmBar, {
              t,
              title: pending.kind === 'update' ? t.gitUpdateConfirm : t.gitRestoreConfirm,
              body:
                pending.kind === 'update'
                  ? t.gitUpdateBody(
                      row.name,
                      String(preview?.detail?.from?.revision ?? row.revision ?? '').slice(0, 7),
                      String(preview?.detail?.to?.revision ?? '').slice(0, 7) || '—',
                    )
                  : t.gitRestoreBody(row.name, pending.revision.slice(0, 7)),
              notes: pending.kind === 'update' ? t.gitUpdateNotes : [t.gitUndoSnapshot],
              busy: busyKind !== null,
              confirmLabel: pending.kind === 'update' ? t.gitUpdate : t.gitRestoreTo,
              onCancel: () => setPending(null),
              onConfirm: () => apply(pending.kind, pending.revision ?? null),
            }),
      )
    }

    /**
     * The Git half of the Skills tab.
     *
     * Kept beside the catalog table rather than inside a row because a
     * registration is about a source, not about a directory the host happened to
     * scan: the host may not know the Skill yet at all.
     */
    function GitSkillsView(props) {
      const { t, language, rows, onChanged } = props
      return h(
        'div',
        { style: { marginTop: 22, paddingTop: 12, borderTop: `1px solid ${COLORS.line}` } },
        h(GitRegisterForm, { t, onRegistered: onChanged }),
        rows.length === 0
          ? h('div', { style: { fontSize: 12, opacity: 0.7, padding: '10px 0' } }, t.gitEmpty)
          : h(
              'div',
              { style: { marginTop: 10 } },
              rows.map((row) => h(GitSkillRow, { key: row.name, row, t, language, onChanged })),
            ),
      )
    }

    function SkillsView(props) {
      const { t, language, state, onReload, loading } = props
      const data = state
      const skills = data?.skills ?? []
      const header = h(
        'div',
        { style: { display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 4 } },
        h(
          'div',
          { style: { flex: '1 1 320px', minWidth: 0 } },
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, t.skillsTitle),
          h('div', { style: { fontSize: 12, opacity: 0.7, marginTop: 2 } }, t.skillsSubtitle),
        ),
        h(Button, { onClick: onReload, disabled: loading === true }, loading === true ? t.refreshing : t.refresh),
      )

      if (data === null) {
        return h('div', null, header, h('div', { style: { fontSize: 12, opacity: 0.7, marginTop: 10 } }, t.started))
      }
      if (data.available !== true) {
        return h(
          'div',
          null,
          header,
          h(Notice, { tone: 'warn', title: t.errorLabel }, data.reason ?? t.skillsUnavailable),
          // A Skill this plugin keeps in step with a Git tree does not need the
          // host's catalog to be written, so the form stays available here.
          h(GitSkillsView, { t, language, rows: data.git?.skills ?? [], onChanged: onReload }),
        )
      }

      const table = h(
        'table',
        { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 10 } },
        h(
          'thead',
          null,
          h(
            'tr',
            { style: { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 } },
            h('th', { scope: 'col', style: { padding: '4px 8px', fontWeight: 500 } }, t.skillColName),
            h('th', { scope: 'col', style: { padding: '4px 8px', fontWeight: 500 } }, t.skillColSource),
            h('th', { scope: 'col', style: { padding: '4px 8px', fontWeight: 500 } }, t.skillColFiles),
            h('th', { scope: 'col', style: { padding: '4px 8px', fontWeight: 500 } }, t.skillColGit),
            h('th', { scope: 'col', style: { padding: '4px 8px', fontWeight: 500 } }, t.skillColSnapshots),
            h('th', { scope: 'col', style: { padding: '4px 8px', fontWeight: 500 } }, t.skillColActions),
          ),
        ),
        h(
          'tbody',
          null,
          skills.map((skill) => h(SkillRow, { key: skill.name, skill, t, language, onTake: onReload })),
        ),
      )

      return h(
        'div',
        null,
        header,
        data.complete === false ? h(Notice, { tone: 'warn', title: t.errorLabel }, t.skillsIncomplete) : null,
        data.provider === null ? null : h('div', { style: { fontSize: 11, opacity: 0.6, marginTop: 6 } }, t.skillsProvider(data.provider)),
        skills.length === 0
          ? h('div', { style: { fontSize: 12, opacity: 0.7, padding: '12px 0' } }, t.skillsEmpty)
          : table,
        // The Git section is shown even when the catalog is empty: a Skill this
        // plugin manages may not have been scanned yet, and the form is the way
        // to stop relying on that.
        h(GitSkillsView, { t, language, rows: data.git?.skills ?? [], onChanged: onReload }),
      )
    }

    function Panel() {
      const language = useMemo(pickLanguage, [])
      const t = TEXT[language]
      const [state, setState] = useState({ status: 'idle', data: null, error: null })
      const [filter, setFilter] = useState('all')
      const [query, setQuery] = useState('')
      const [expanded, setExpanded] = useState(null)
      const [tab, setTab] = useState('plugins')
      const [skills, setSkills] = useState({ status: 'idle', data: null, error: null })
      const abortRef = useRef(null)
      const skillsAbortRef = useRef(null)

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

      const loadSkills = useCallback(async () => {
        skillsAbortRef.current?.abort()
        const controller = new AbortController()
        skillsAbortRef.current = controller
        setSkills((previous) => ({ ...previous, status: 'loading' }))
        try {
          const data = await request('/skills', { signal: controller.signal })
          setSkills({ status: 'ready', data, error: null })
        } catch (error) {
          if (error?.name === 'AbortError') return
          setSkills((previous) => ({ status: 'failed', data: previous.data, error }))
        }
      }, [])

      useEffect(() => {
        refresh()
        return () => abortRef.current?.abort()
      }, [refresh])

      // The skills catalog is loaded when its tab is first opened: nothing on the
      // plugin list needs it, and reading it walks directories on the host.
      useEffect(() => {
        if (tab !== 'skills') return undefined
        if (skills.status !== 'idle') return undefined
        loadSkills()
        return undefined
      }, [tab, skills.status, loadSkills])

      useEffect(() => () => skillsAbortRef.current?.abort(), [])

      const rows = state.data?.plugins ?? []
      const visible = useMemo(() => {
        const needle = query.trim().toLowerCase()
        return rows.filter((row) => {
          if (filter === 'writable' && row.updateRefusal !== null) return false
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
            h(
              'span',
              null,
              `${t.host}: ${state.data?.host?.runtimeVersion ?? t.unknown}`,
              state.data?.host?.runtimeVersion && state.data?.host?.runtimeSource
                ? ` (${t.runtimeSource(state.data.host.runtimeSource)})`
                : '',
            ),
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
            ['writable', t.filterWritable],
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
          : h('span', { style: { fontSize: 12, opacity: 0.7 } }, t.counts(
              state.data.counts.total,
              state.data.counts.writable,
              state.data.counts.official,
              state.data.counts.unsatisfied ?? 0,
              state.data.counts.unknownCompatibility ?? 0,
            )),
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
        h(
          'div',
          { style: { display: 'flex', gap: 6, marginTop: 12, borderBottom: `1px solid ${COLORS.line}` }, role: 'tablist' },
          ...[
            ['plugins', t.tabPlugins],
            ['skills', t.tabSkills],
          ].map(([key, label]) =>
            h(
              'button',
              {
                key,
                type: 'button',
                role: 'tab',
                'aria-selected': tab === key ? 'true' : 'false',
                onClick: () => setTab(key),
                style: {
                  font: 'inherit',
                  fontSize: 12,
                  padding: '5px 10px',
                  border: 'none',
                  borderBottom: `2px solid ${tab === key ? 'currentColor' : 'transparent'}`,
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  opacity: tab === key ? 1 : 0.65,
                },
              },
              label,
            ),
          ),
        ),
        tab === 'skills'
          ? h(SkillsView, {
              t,
              language,
              state: skills.data,
              loading: skills.status === 'loading',
              onReload: loadSkills,
            })
          : toolbar,
        tab !== 'plugins'
          ? skills.error === null
            ? null
            : h(Notice, { tone: 'fail', title: t.errorLabel }, describeError(skills.error, t))
          : state.data === null
            ? null
            : visible.length === 0
              ? h('div', { style: { fontSize: 12, opacity: 0.7, padding: '12px 0' } }, t.noNewerVersions)
              : table,
        tab !== 'plugins' || state.data === null
          ? null
          : h(
              'div',
              { style: { marginTop: 18 } },
              h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, t.operations),
              h(OperationsList, { t, language, operations: state.data.operations ?? [] }),
            ),
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

      // Each slot is an independent extension point: the host only lets a plugin
      // register into a slot it has explicitly injected. Registering two slots
      // therefore needs two injections, not one injection and two registers.
      ctx.slots.inject('main', () => {
        const stopMain = ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            inject: () => ({}),
          },
          Panel,
        )
        return () => {
          try {
            if (typeof stopMain === 'function') stopMain()
          } catch (error) {
            console.error('dsh-version-manager: panel cleanup failed', error)
          }
        }
      })

      ctx.slots.inject('sidebar.panellist', () => {
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
        }
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
