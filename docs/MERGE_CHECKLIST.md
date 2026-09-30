# 主分支合并与回归排查手册 (Merge Checklist)

> **重要准则**：
> 每次从上游/主分支（`origin/master`）合并到当前发布分支（如 `winexeNew` / `winexeBuilder`）后，**必须严格按照本手册列出的所有项目逐一进行系统性排查与验证**。
> 未完成全部项目排查前，严禁提交推送或发布构建，严防已知易导致问题（Zero Regression）。

---

## 目录
- [一、构建与依赖锁定门禁 (Build & Dependencies)](#一构建与依赖锁定门禁-build--dependencies)
- [二、原生与桌面进程生命周期 (Native & Process Lifecycle)](#二原生与桌面进程生命周期-native--process-lifecycle)
- [三、Web 界面与交互防崩溃红线 (Client UI & Component Stability)](#三web-界面与交互防崩溃红线-client-ui--component-stability)
- [四、内置社区插件配置规约 (Builtin Plugins Specification)](#四内置社区插件配置规约-builtin-plugins-specification)
- [五、上游版本升级与弹窗机制 (Upstream Changes & Notices)](#五上游版本升级与弹窗机制-upstream-changes--notices)
- [六、合并操作标准作业程序 (SOP)](#六合并操作标准作业程序-sop)

---

## 一、构建与依赖锁定门禁 (Build & Dependencies)

### 1.1 `pnpm-lock.yaml` 依赖声明规约对齐与临时路径排查
- **历史 BUG**：
  CI 执行 `pnpm install --frozen-lockfile` 时报错 `[ERR_PNPM_OUTDATED_LOCKFILE]`。原因是 `package.json` 中声明为 `workspace:*`，但在合并或手改后 `pnpm-lock.yaml` 中残存 `workspace:^`；或开发者机器上的临时绝对路径（如 `file:C:/Windows/TEMP/...`）被意外写入锁文件。
- **排查要点**：
  1. 检查所有工作区包依赖版本格式是否统一为规范的 `workspace:*`，禁止出现 `workspace:^`。
  2. 检索 `pnpm-lock.yaml` 中是否含有本地临时目录或绝对路径。
  3. **必跑验证命令**：
     ```sh
     $env:pnpm_config_verify_deps_before_run='false'; pnpm install --frozen-lockfile --lockfile-only
     ```
     必须确保退出码为 0，锁文件与各 package.json 完全一致。

### 1.2 `tsdown.config.ts` 历史残留未跟踪目录排除
- **历史 BUG**：
  仓库内存在非 package.json 目录（如历史残留 `packages/code-runtime`、`packages/e2b` 等），触发 `tsdown` 递归扫描并抛错 `Cannot find entry`。
- **排查要点**：
  检查 [tsdown.config.ts](../tsdown.config.ts) 中的 `exclude` 数组，确认非活跃包路径被正确排除：
  ```ts
  exclude: ['packages/*/*/node_modules/**', 'packages/code-runtime/**', 'packages/e2b/**']
  ```

### 1.3 `scripts/install-lefthook.mjs` 完整性与安装锁排查
- **历史 BUG**：
  合并后丢失 `loadLefthookPackage` 函数定义，或者由于上次异常中断残留了 `.git/dsh-lefthook-install.lock`，导致后续 `pnpm install` 阶段报 `stale Lefthook installer lock`。
- **排查要点**：
  1. 确认 [scripts/install-lefthook.mjs](../scripts/install-lefthook.mjs) 包含完整的 `loadLefthookPackage(root)` 逻辑。
  2. 确认 `.git/dsh-lefthook-install.lock` 不存在。执行脚本或 CI 时配置环境变量 `$env:LEFTHOOK='0'`。

### 1.4 `scripts/build-web-exe.ts` 部署镜像源保障
- **历史 BUG**：
  在执行 `pnpm deploy` 打包 CLI 闭包时，访问官方源下载预编译二进制包（如 `libreoffice-kit-win32-x64`）频繁报 `error (23)` 超时。
- **排查要点**：
  确认 [scripts/build-web-exe.ts](../scripts/build-web-exe.ts) 在 `pnpm deploy` 参数列表中显式注入了镜像源参数：
  ```ts
  '--config.registry=https://registry.npmmirror.com',
  ```

### 1.5 TypeScript Composite 项目引用配置
- **历史 BUG**：
  Client 包间互相引用时报 `error TS6306: Referenced project ... must have setting "composite": true`。
- **排查要点**：
  检查 `packages/client/*` 各子包的 `tsconfig.json`，确保引用的兄弟客户端包均指向对应包的 `tsconfig.client.json`。

---

## 二、原生与桌面进程生命周期 (Native & Process Lifecycle)

### 2.1 Win32 原生文件夹选择器（`win32-dialog-worker.ts`）IPC 生命周期与窗口可见性
- **历史 BUG**：
  在“编辑项目”点击“添加文件夹”时，选择窗口瞬间退出消失并返回 `null`（或者表现为完全无响应）。原因有两个：
  1. worker 在发出 `showing` 通知时误调用了全局 `post`，而 `post` 在发送后立刻执行了 `process.disconnect()`，触发 `process.on('disconnect', () => process.exit(0))`，使窗口还没展示就被自身杀死。
  2. 派生 worker 子进程时如果传入了 `windowsHide: true`，Windows 会在 `STARTUPINFO` 中注入 `SW_HIDE`，导致 GUI 子进程创建的首个窗口（IFileOpenDialog）被系统判定为隐藏窗口而不渲染展示。
- **排查要点**：
  1. 核查 [packages/host/directory-picker-native/src/win32-dialog-worker.ts](../packages/host/directory-picker-native/src/win32-dialog-worker.ts)：
     ```ts
     const post = (message: Win32DialogWorkerMessage): void => {
       // 关键守卫：showing 阶段严禁断开 IPC，必须保持进程常驻阻塞直到用户操作完毕！
       if (message.kind === 'showing') {
         send(message)
         return
       }
       send(message, () => { if (process.connected) process.disconnect() })
     }
     ```
     确保只有在 `done` 或 `error` 终态时才执行 disconnect 退出。
  2. 核查 [packages/host/directory-picker-native/src/win32-dialog-host.ts](../packages/host/directory-picker-native/src/win32-dialog-host.ts)：
     创建对话框 worker 时必须显式声明 `windowsHide: false`，确保系统原生对话框窗口在前台可见。
  3. 核查 [packages/host/directory-picker-native/src/win32-dialog-bindings.ts](../packages/host/directory-picker-native/src/win32-dialog-bindings.ts)：
     `IModalWindow::Show` 必须传入 `GetForegroundWindow()` 获取的宿主窗口句柄（而不是 `null`），确保系统文件夹选择框作为浏览器的模态子窗口居中弹出在最前台，绝不会被全屏浏览器遮挡在后方。
  4. 核查 [apps/cli/src/packaged-web-home.ts](../apps/cli/src/packaged-web-home.ts) 与 [packages/host/directory-picker-auto/src/resolve.ts](../packages/host/directory-picker-auto/src/resolve.ts)：
     Windows 打包版桌面 Web 界面必须默认使用应用内弹窗选择器（`DSH_DIRECTORY_PICKER=browse`），使“添加文件夹”与“添加工作区”直接在浏览器界面内唤起标准 DirectoryBrowser 弹窗，保证跨环境 100% 稳定响应。

### 2.2 打包 PTC 运行环境标志（`DSH_PTC_RUNTIME_NODE=1`）
- **历史 BUG**：
  桌面可执行文件运行 `run_code` 或 PTC 子进程时，报 `Node process exited before completing (0)`，子进程静默退出。
- **根因**：
  打包后的 `dsh-web.exe` 将没有此标志的子进程当做二次启动的 GUI，触发单实例互斥锁直接 exit 0。
- **排查要点**：
  1. 检查 `packages/ptc-runtime/ptc-runtime-node/src/index.ts`，必须保持注入：
     ```ts
     env.DSH_PTC_RUNTIME_NODE = '1'
     ```
  2. 检查 `apps/cli/packaged-web-launcher.cjs` 与 `apps/cli/src/packaged-web-bin.ts` 中针对 `PTC_RUNTIME_NODE_ENV` 的分支分发。

### 2.3 托盘常驻守护（`bootProfile`）生命周期
- **历史 BUG**：
  Web 服务因异常或配置重载停止时，托盘图标一并退出，导致主进程退出。
- **排查要点**：
  检查 [apps/cli/src/profile-boot.ts](../apps/cli/src/profile-boot.ts) 与托盘常驻逻辑，确保保留 `bootProfile`，使得 Web 服务停止时桌面托盘宿主不退出。

### 2.4 进程沙箱创建标志（严禁 `CREATE_NO_WINDOW`）
- **历史 BUG**：
  使用原始进程创建标志 `CREATE_NO_WINDOW` (`0x08000000`) 导致 Windows 子进程挂起、沙箱拒绝访问或闪黑框。
- **排查要点**：
  主分支规范使用 `STARTF_USESHOWWINDOW` + `SW_HIDE` 或 Node 原生 `windowsHide: true`。排查所有新合入的子进程派生代码，禁止恢复裸写 `CREATE_NO_WINDOW`。

### 2.5 打包保留数据时排除锁定中的 Chromium 目录
- **历史 BUG**：
  在打包或重构绿色包时，因本地 Edge 正在运行产生文件占用，报错 `EBUSY: copyfile ... \.config\desktop-chromium\Default\Network\Cookies`。
- **排查要点**：
  检查 [scripts/preserve-packaged-web-home.ts](../scripts/preserve-packaged-web-home.ts) 的 `OMITTED_HOME_SEGMENTS`，确认 `'desktop-chromium'` 包含其中，避免复制运行中的浏览器网络缓存与 Cookie 文件。

---

## 三、Web 界面与交互防崩溃红线 (Client UI & Component Stability)

### 3.1 `Menu.tsx` 深度重渲崩溃与项目编辑状态解耦
- **文件夹选取状态解耦**：
  [packages/client/ui-workspace/src/client/WorkspaceEditDialog.tsx](../packages/client/ui-workspace/src/client/WorkspaceEditDialog.tsx) 的 `busy` 属性必须仅表示保存（`editSaving`），文件夹选取中必须使用独立的 `pickingFolder` 属性（仅禁用“添加文件夹”自身）。严禁在选取过程中将整个对话框及其“取消/关闭”操作设为全局 `busy`，否则任何等待或错误都会导致页面出现“点击无响应、页面假死”现象；同时 `renderDirectoryFlow` 必须显式处理 `onError` 并重置 `addFolderTarget`。
- **历史 BUG**：
  在侧边栏触发任何状态变化（如打开文件选择器导致 `directoryBusy` 改变）时，工作区瞬间崩溃消失、编辑弹窗消失、界面跌落到新建会话。
- **根因**：
  [packages/client/ui-primitives/src/Menu.tsx](../packages/client/ui-primitives/src/Menu.tsx) 将 `setOpenSubmenuId(null)` 写在包含 `[open, onClose, autoFocus]` 的全局监听 effect 中。父组件每次重渲导致 `onClose` 引用变更，即使菜单未打开（`!open`）也会在该 effect 中调用 `setState`，引发级联无限死循环渲染。
- **排查要点**：
  1. 核查 [Menu.tsx](../packages/client/ui-primitives/src/Menu.tsx)：
     ```tsx
     useEffect(() => {
       if (!open) {
         triggerRef.current = null
         walkIndex.current = null
         setOpenSubmenuId(current => current === null ? null : null)
         return
       }
       // ...
     }, [open])

     useEffect(() => {
       if (!open) return // 必须在未打开时立即返回，严禁执行任何状态更新！
       // ...
     }, [open, onClose, autoFocus])
     ```
  2. 涉及包含菜单的组件（如 `ViewOptionsMenu`、`WorkspaceBrowser`），其传递给 `Menu` 的 `onClose` 回调必须严格使用 `useCallback` 缓存。

### 3.2 侧边栏/工作区交互状态规范（`statuses` vs `pendingInteractions`）
- **历史 BUG**：
  合并时错误引入旧版分支的 `pendingInteractions`，导致与主分支重构后的交互队列冲突。
- **排查要点**：
  主分支规范全面采用 `statuses`。搜索排查客户端工作区代码，禁止出现 `pendingInteractions` 字段。

### 3.3 `shortcuts.ts` 状态更新的幂等性守卫
- **历史 BUG**：
  重复派发相同值的状态更新（例如在文件流轮询中不断调用 `directoryBusy(true)`），导致整个侧边栏树反复无效重渲染。
- **排查要点**：
  核查 [packages/client/ui-workspace/src/client/shortcuts.ts](../packages/client/ui-workspace/src/client/shortcuts.ts) 中的更新回调，确保带有值比对守卫：
  ```ts
  directoryBusy: (busy: boolean) => {
    const current = state.getSnapshot()
    if (current.directoryBusy !== busy) state.set({ ...current, directoryBusy: busy })
  },
  ```

### 3.4 空工作区会话自动创建范围
- **历史 BUG**：
  点击非叶子或已有会话的空工作区行时，误触发了新建会话流程。
- **排查要点**：
  检查 [packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx](../packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx)：
  必须且仅当满足“真实工作区”、“会话数为 0”且“子工作区为 0”（纯叶子无会话）时，点击才新建会话：
  ```tsx
  if (group.workspaceId !== undefined && group.sessionCount === 0 && children.length === 0) {
    setGroupExpanded(group.key, true)
    startSession(group.workspaceId)
    return
  }
  ```

### 3.5 最近会话折叠判定守卫
- **历史 BUG**：
  在“最近会话”已经折叠的情况下调用 `collapseRecents()`，误触发了反向展开。
- **排查要点**：
  `collapseRecents` 必须仅在属性 `aria-expanded === 'true'` 时才执行点击折叠动作。

---

## 四、内置社区插件配置规约 (Builtin Plugins Specification)

### 4.1 `scripts/builtin-profile-plugins.json` 插件版本与清单排查
- **排查要点**：
  核对 [scripts/builtin-profile-plugins.json](../scripts/builtin-profile-plugins.json) 清单，确保包含以下最新锁定版本，且绝对不可遗漏：
  - `dshmarket`: `1.66.3+`
  - `@linxin666/dsh-web-all`: `0.4.3+`
  - `dsh-all-usage`: `1.1.15+`
  - `dsh-free-search`: `0.4.39+`
  - `dsh-skillhub`: `github:vonweller/dsh-skillhub`
  - **特别注意**：确保已移除已废弃的 `@ychris12138/dsh-usage-stats`。

### 4.2 Git URL 依赖规格支持
- **历史 BUG**：
  构建脚本中的版本正则表达式只接受语义化版本（如 `1.0.0`），导致遇到 `github:owner/repo` 规则时报错 `builtin plugins did not resolve at the pinned version`。
- **排查要点**：
  检查 [scripts/build-builtin-profile-plugins.ts](../scripts/build-builtin-profile-plugins.ts)：
  ```ts
  const EXACT_VERSION_PATTERN = /^(?:[~^]?d+.d+.d+|github:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:#.*)?)$/
  ```
  确保运行以下测试通过：
  ```sh
  node node_modules/vitest/vitest.mjs run scripts/build-builtin-profile-plugins.spec.ts
  ```

---

## 五、上游版本升级与弹窗机制 (Upstream Changes & Notices)

### 5.1 《预览版说明》（`WelcomeNotice.tsx`）确认机制
- **现象说明**：
  合并主分支版本号升级（如 `0.2.0-rc.1`）后，界面正中可能弹出不可避让的《预览版说明》弹窗。
- **机制与原因**：
  上游官方在 [packages/client/ui-settings-models/src/client/WelcomeNotice.tsx](../packages/client/ui-settings-models/src/client/WelcomeNotice.tsx) 中设置了版本强校验，每次底层主版本递增都会重置确认状态，要求用户点击“继续”以持久化确认。并非 UI 异常，确认一次后即正常写入本地存储不再弹出。

---

## 六、合并操作标准作业程序 (SOP)

每次执行主分支合并时，执行以下固定工作流：

### 步骤 1：本地干净合并
```sh
$env:LEFTHOOK='0'
git fetch origin master
git merge origin/master -m "merge origin/master into <branch>"
```
确认全部自动合并文件无冲突遗留标记。

### 步骤 2：执行依赖与锁文件校验
```sh
$env:pnpm_config_verify_deps_before_run='false'
$env:LEFTHOOK='0'
pnpm install --frozen-lockfile --lockfile-only --config.confirmModulesPurge=false
```
确认退出码为 0，锁文件无未提交脏改动。

### 步骤 3：核心回归测试集自测
```sh
node node_modules/vitest/vitest.mjs run scripts/build-builtin-profile-plugins.spec.ts
node node_modules/vitest/vitest.mjs run packages/client/ui-workspace/tests/tree.client.spec.ts
node node_modules/vitest/vitest.mjs run packages/client/ui-workspace/tests/workspace-edit-dialog.client.spec.tsx
node node_modules/vitest/vitest.mjs run packages/host/directory-picker-native/tests/win32-dialog.spec.ts
```
确认全部用例 100% 通过。

### 步骤 4：端到端绿色桌面包构建