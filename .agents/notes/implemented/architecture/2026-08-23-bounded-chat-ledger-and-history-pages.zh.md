# Agent Note: 有界的聊天账本与历史分页

Status: implemented

[English](2026-08-23-bounded-chat-ledger-and-history-pages.md) | 中文

## Problem

一个长跑会话——单轮内数百个工具步骤——让对话视图越跑越卡，切回去时也会顿一下。三个无界量叠加：`session.history` 只按消息计数，无论 `maxMessages` 怎么调，一整轮的工具事件总量都挤在同一页；`ChatView` 对整个已加载窗口的每个业务节点各挂一行；贴底跟随签名包含 `order.length`，于是每追加一步都在这份全量挂载的列表上强制一次滚底写入。

## Decision

每一层各自持有一个界限，并相互组合：

- 宿主分页（`packages/host/apiproxy`）在 `maxMessages` 之外引入独立的工具事件预算：每页至多 80 个 `tool/call`／`tool/result` 事件。预算用尽后，反向扫描只推进到下一个不拆分调用对的边界——以「尚未扫到其配对 call 的 result」追踪——因此切点绝不会落在 call 与它的 result 之间，任何一页都不会拆散一次交换。
- `ChatView`（`packages/client/ui-conversation`）在不超过 48 个业务节点时按普通列布局渲染，超过后切换为虚拟账本：`@tanstack/react-virtual` 仅挂载视口加 overscan 的行，对每个渲染出的行盒施加 `measureElement`，被跳过的区间用显式 spacer 顶替。纵向节奏从容器 gap 改为每行自身的尾部内边距，让每个被测量的 border-box 自带间距；行上方一个零高度标记为账本提供内容偏移，使提示与「加载更早」按钮留在账本之外。虚拟化生效时跟随签名不再统计行数：钉底状态下普通尾部追加经由列尺寸观察器与虚拟器的末端锚点保持贴底；读者滚动归因不受影响；手动前置锚定仍是普通路径的机制（账本上的前置稳定性交给虚拟器的末端锚点）；已保存位置若其锚点行不在首批估算窗口内，则经索引跳转恢复而非裸像素写入。
- 客户端 runtime 的 `Session`（`packages/client/runtime`）在实时事件数超过 800 时淘汰常驻窗口前缀：从预算线上最早的合格 `turn/start` 边界处切割（单轮独大时回退到最早的 `step/start`，无合格边界则跳过），并重新打开 `hasMore` 让 loadOlder 继续负责被丢弃的区间。会话 Definition 本就通过 windowGap 依赖容忍「从中途开始」的窗口；淘汰只是本地记账，绝不触发重取。

## Alternatives considered

- **按字节预算分页** — 否决：字节计量会把宿主耦合到载荷编码上，页面组成随序列化器漂移；按事件类型计数契合既有的 `maxMessages` 语义且可直接测试。
- **始终开启虚拟化** — 否决：短对话与 jsdom 组件套件从账本中一无所得，而阈值让普通路径与既有滚动契约逐字节兼容。
- **任意的轮内前缀淘汰** — 否决：在运行中的轮次内部丢事件会无谓地劣化活跃节点关联；生命周期边界以可预测的读者可见损失给出同样的界限。

## Consequences

- 切入长会话时挂载的行数有界，单步渲染成本不再随日志长度增长；合成浏览器滚动 lane 不锚定 DOM 数量断言，因此无需修改即验证了该虚拟化实现。
- 工具密集的轮次分页低于消息配额：深读历史需要更多 loadOlder 往返，运行中轮次的尾页只携带其最新的若干次交换。
- 超限的常驻窗口就地遗忘最旧内容，直到读者翻页取回；不会在读者背后重取，重连 resync 重建后同样回到预算内。
- 页面权重仍不按字节封顶——一次携带超大工具结果的交换即可占满一页（[大 provenance 扫描笔记](../bug-fix/2026-08-04-large-history-pagination-call-stack.zh.md)）；两个关注点仍然彼此独立。
- 账本上的锚点所有权与 [sticky-composer 滚动笔记](../bug-fix/2026-07-29-sticky-composer-conversation-scroll.zh.md)出现分工：其手动锚点只治理普通路径。
