# 按问答选择分享网页聊天 - 产品需求文档

## Overview
- **Summary**: 在网页聊天中新增"按问答（回合）选择分享"能力：用户可加载会话较早记录，勾选若干不连续的完整问答，预览确认后生成公开链接；公开快照仅包含所选问答及其引用、附件与工具结果。
- **Purpose**: 现有分享会把整段聊天公开，长对话中容易带出无关问答与敏感内容。需要最小化公开面，让用户只分享研究结论相关的回合。
- **Target Users**: Khoj 网页端（web）已登录用户，在自己的会话中通过会话菜单/聊天头部发起分享；公开链接的访问者（无需登录）。

## Goals
- 支持在网页端按完整问答回合多选（允许不连续）、可加载较早记录、可预览。
- 没有 `turnId` 的旧聊天也能按一问一答成组选择。
- 确认后生成公开链接，快照按原顺序保留所选回合的全部内容（引用 references、图片/文件附件、online/code/research/operator 等工具结果、trainOfThought）。
- 公开历史接口在任何参数组合下都不返回未选问答。
- 只能选择当前账号自己的会话；异常输入给出明确原因且不生成链接。
- 分享是不可变快照：不修改原会话，原会话后续聊天不影响已生成链接。
- 原有"整段分享"和"取消分享"行为保持不变。

## Non-Goals
- 不改造桌面端、Obsidian、Emacs、WhatsApp 等其他客户端的分享体验。
- 不为旧消息回填/持久化 `turnId`（不改写原会话数据）。
- 不做分享后增量编辑（增删已选回合需重新生成链接，本期不做）。
- 不改变公开页的 fork（基于公开会话继续对话）交互，仅保证其对选择性快照可用。
- 不新增分享访问控制（密码、过期时间、访问统计）。

## Background & Context

### 现状链路（代码证据）
- 会话模型 [Conversation](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/khoj/database/models/__init__.py#L656-L699)：`conversation_log` 为 JSON，形如 `{"chat": [msg, ...]}`；消息结构见 [ChatMessageModel](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/khoj/database/models/__init__.py#L117-L133)，含 `by`（"you"/"khoj"）、`message`、`created`、`context`（引用）、`onlineContext`、`codeContext`、`researchContext`、`operatorContext`、`trainOfThought`、`images`、`queryFiles`、`turnId`、`intent` 等。
- 每个回合通常由同一 `turnId` 的两条消息（user、khoj）组成，见 [generate_chatml_messages 写库逻辑](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/khoj/processor/conversation/utils.py#L566-L585)；删除回合按 `turnId` 过滤，见 [delete_message_by_turn_id](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/khoj/database/adapters/__init__.py#L1833-L1844)。
- 旧消息可能没有 `turnId`；被中断的回合可能只有用户消息或 khoj 空消息。
- 公开快照模型 [PublicConversation](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/khoj/database/models/__init__.py#L730-L750)：保存时自动生成唯一 slug；复制逻辑 [make_public_conversation_copy](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/khoj/database/adapters/__init__.py#L997-L1006) 整体拷贝 `conversation_log`（天然快照语义）。
- API（[api_chat.py](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/khoj/routers/api_chat.py)）：
  - `POST /api/chat/share?conversation_id=...`（需登录，含 ALLOWED_HOSTS 域名校验，按 user+client 过滤会话）整段复制并返回 url（L443-L476）。
  - `DELETE /api/chat/share?public_conversation_slug=...`（L479-L503）。
  - `GET /api/chat/share/history?public_conversation_slug=...&n=...`（L302-L377）**无需登录**，n>0 返回最新 n 条、n<0 返回除最新 |n| 条外的较早消息。
  - `POST /api/chat/share/fork`（L402-L440）把公开会话复制为私有会话。
  - `GET /api/chat/history?conversation_id=...&n=...`（L237-L299）需登录，分页协议与 share/history 一致。
- 前端：
  - 分享入口 [ChatSessionActionMenu](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/interface/web/app/components/allConversations/allConversations.tsx#L487-L689)：点击 Share 立即 POST 整段分享，随后弹窗展示/复制 URL；聊天页头部与侧边栏会话项均使用该菜单（[chat/page.tsx#L601](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/interface/web/app/chat/page.tsx#L601-L605)）。
  - 历史渲染 [chatHistory.tsx](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/interface/web/app/components/chatHistory/chatHistory.tsx#L406-L471) 用递增 n 实现"加载更早消息"。
  - 公开页 [share/chat/page.tsx](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/interface/web/app/share/chat/page.tsx) 复用 ChatHistory 渲染，所有者可见取消分享按钮。
- 测试基座：pytest + Django，`client` 夹具 + `Authorization: Bearer kk-secret`（见 [test_conversation_export.py](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/tests/test_conversation_export.py#L66-L82)）；前端无单测框架，以 `next lint`/`next build` 与浏览器手工验证为准。

### 关键设计决策
- **快照即过滤副本**：选择性分享仍写入 `PublicConversation`，仅把 `conversation_log` 替换为 `{"chat": [所选消息原序]}`，无需数据库迁移；公开接口读不到未选内容，隔离性由存储保证而非接口裁剪。
- **回合分组语义（后端唯一事实源）**：按完整日志单遍分组——
  - 有 `turnId` 的消息：按 `turnId` 归组（同组消息保持原序，跨位置同 id 也归并，与删除回合语义一致）；
  - 无 `turnId` 的消息：遇到 `by=="you"` 开启新遗留组，其后无 `turnId` 的消息（含若干 khoj 消息）并入，直到下一个用户消息或下一个带 `turnId` 的消息；开头孤立的 khoj 消息单独成组但不可选；
  - "完整可选回合"要求组内至少 1 条 `you` 消息且至少 1 条非空 khoj 消息。
- **不透明选择令牌**：`GET /api/chat/history` 在**响应中**（不落库）为每条消息追加 `shareToken` 与 `turnSelectable`：
  - 现代回合：`turn:<turnId>`；
  - 遗留回合：`legacy:<首条消息下标>:<created>:<首条消息内容摘要sha256前12位>`，用于检测删除/错位（删除较早消息导致下标漂移时摘要不匹配 → 报错）。
  - 前端不实现摘要算法，只按同 token 渲染勾选框并原样回传。
- `POST /api/chat/share` 增加可选 JSON body `{"turns": [token, ...]}`；省略时维持整段分享（完全向后兼容）。

## Functional Requirements
- **FR-1（选择入口）**：在现有会话分享菜单中，用户可选择"整段分享"（现有即时流程）或"选择问答分享"（新流程）。
- **FR-2（加载较早记录）**：选择对话框分页加载该会话全部历史（含最早消息），加载中显示状态，全部加载后不再提供加载入口。
- **FR-3（按回合勾选）**：对话框以回合为单位展示勾选框，同一回合的用户问与 khoj 答整体勾选；支持不连续多选；不完整回合（如仅提问无回答）不可勾选并可见原因。
- **FR-4（旧聊天可组）**：无 `turnId` 的消息按 FR-5 的分组规则同样形成可勾选回合。
- **FR-5（预览）**：用户可在确认前查看所选问答的预览，预览按原顺序展示，包含回答正文及引用面板所需数据、图片/附件、工具结果（online/code 上下文、trainOfThought 等），不展示删除/重试/反馈等会话内操作按钮。
- **FR-6（确认生成）**：确认后调用分享接口并回传所选令牌；成功后展示与现有一致的公开 URL 弹窗（可复制）。
- **FR-7（选择性快照）**：后端解析令牌→定位当前日志中的回合→校验完整→仅把所选回合消息按原顺序写入新 PublicConversation；保留消息全部原始字段；不修改源 Conversation。
- **FR-8（整段分享兼容）**：不带 turns 的 POST 行为与返回结构不变；DELETE 取消分享、公开页渲染与 fork 保持可用。
- **FR-9（错误处理）**：未选任何问答、令牌无法解析（含遗留组错位/摘要不符，意味着所选问答被删除或变更）、回合不完整时，接口返回 400 与具体原因，且不创建任何 PublicConversation；前端在对话框内展示原因，不跳转、不生成链接。
- **FR-10（权限）**：选择与确认接口仅接受当前登录账号拥有（同 user、同 client）的会话；他人/不存在的 conversation_id 返回错误且不产生公开记录。
- **FR-11（公开隔离）**：`GET /api/chat/share/history` 对选择性快照只返回已选消息；n 分页只在该子集内切片。
- **FR-12（快照不可变）**：分享成功后，源会话新增回合、删除消息、重命名均不改变已生成公开快照内容。

## Non-Functional Requirements
- **NFR-1（安全）**：选择性分享不得引入任何能通过 slug 读到源会话未选消息的路径；令牌只在创建时一次性校验，不跨会话可用。
- **NFR-2（性能）**：分组与快照构建为 O(n)（n=会话消息数），在请求内完成，不新增 N+1 查询；对话框首屏加载沿用现有分页量级。
- **NFR-3（兼容）**：所有接口变更为加字段/加可选 body，不破坏桌面端等旧客户端（旧客户端不传 turns 即整段分享；忽略响应中新增字段）。
- **NFR-4（质量）**：后端新增 pytest 覆盖正常与全部错误路径；前端通过 TypeScript/ESLint 与生产构建。

## Constraints
- **Technical**: Django + Django ORF（JSONField）+ FastAPI 风格 router（[api_chat.py](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/khoj/routers/api_chat.py)）；前端 Next.js 15 + React 18 + Tailwind + shadcn/ui（Dialog/Checkbox/ScrollArea/Button 等已具备）。不新增依赖、不做数据库迁移。
- **Business**: 公开链接任何人可见（现状如此），域名 ALLOWED_HOSTS 校验与遥测沿用现有实现。
- **Dependencies**: 复用 `PublicConversation`、`ConversationAdapters`、现有公开页与 ChatHistory/ChatMessage 渲染。

## Assumptions
- 同一 `turnId` 的消息属于同一回合且可全部选取；正常写库路径下它们相邻且为 you+khoj 各一条（工具结果挂在 khoj 消息字段上）。
- 前端创建分享与最终确认间隔较短；期间源会话被删改属异常路径，按 FR-9 拒绝并让用户重新选择即可。
- `message` 字段可能是空串（中断）或 list（多态），"非空 khoj 回答"按去空白字符串或非空 list 判定。
- 前端构建依赖（node_modules）在实现环境可用；如不可用，以 `tsc --noEmit`/lint 降级验证并在 Review 中标注。

## Acceptance Criteria

### AC-1: 整段分享与取消分享保持可用
- **Type**: `rule`
- **Given**: 已登录用户在自己的多回合会话上打开分享菜单
- **When**: 选择"整段分享"，并在公开页以所有者身份取消分享
- **Then**: 整段分享返回可访问的公开 URL、包含全部消息；DELETE 后再访问该 slug 返回 404
- **Pass Condition**: 回归测试与手工验证均通过，请求/响应结构与现状一致
- **Evidence**: pytest 回归用例；`POST /api/chat/share`（无 body）与 `DELETE /api/chat/share` 的测试输出

### AC-2: 可加载较早记录并按回合不连续勾选
- **Type**: `rule`
- **Given**: 会话消息数超过首屏分页数量
- **When**: 打开"选择问答分享"对话框，点击加载更早记录，勾选第 1 与第 3 个（不连续）完整回合
- **Then**: 对话框可一直加载到最早消息；勾选状态以回合为单位（问+答同时选中），不连续选择被正确保留并显示已选数量
- **Pass Condition**: 浏览器中完成上述操作，DOM 中勾选框状态与已选计数正确
- **Evidence**: 浏览器手工验证记录/截图；组件状态逻辑代码评审

### AC-3: 无 turnId 的旧聊天也能按问答选择
- **Type**: `rule`
- **Given**: 会话全部或部分消息没有 `turnId`（含 you/khoj 交替的旧数据与开头孤立 khoj 消息）
- **When**: 拉取历史并打开选择对话框
- **Then**: 旧消息按一问一答成组获得相同 `shareToken` 且可勾选；孤立/不完整组不可勾选；后端遗留令牌可成功兑换为快照
- **Pass Condition**: 构造无 turnId 会话的 pytest 通过；浏览器中旧会话勾选成功生成链接
- **Evidence**: `tests/test_chat_share.py` 遗留分组用例；手工验证记录

### AC-4: 确认后仅所选回合按原顺序入快照且内容字段完整
- **Type**: `rule`
- **Given**: 含引用(context)、图片/queryFiles 附件、onlineContext/codeContext/trainOfThought 工具结果的多个回合，勾选其中不连续两个
- **When**: POST /api/chat/share 携带对应 turns 令牌
- **Then**: 新建 PublicConversation 的 `conversation_log.chat` 恰为所选回合的消息并集、保持原顺序；每条消息的 context/images/queryFiles/onlineContext/codeContext/trainOfThought 等字段原样保留；源会话日志不变
- **Pass Condition**: pytest 断言消息条数、顺序、各字段深度相等且源会话前后一致
- **Evidence**: `tests/test_chat_share.py` 选择性快照用例

### AC-5: 公开历史接口不返回未选问答
- **Type**: `rule`
- **Given**: 已生成选择性分享链接（源会话 4 回合、仅选 2 回合）
- **When**: 未认证请求 GET /api/chat/share/history，分别带 n=1、n=2、n=-1、不带 n
- **Then**: 任何参数组合返回的消息全部属于所选子集，总数不超过所选消息数，分页只在子集内切片
- **Pass Condition**: pytest 四种参数组合断言通过
- **Evidence**: `tests/test_chat_share.py` 公开隔离用例

### AC-6: 只能分享当前账号自己的会话
- **Type**: `rule`
- **Given**: 用户 B 请求分享用户 A 的 conversation_id（可附带 A 会话中出现过的令牌）
- **When**: 调用 POST /api/chat/share
- **Then**: 返回 404（或现有权限错误），数据库不新增 PublicConversation；令牌无法跨会话兑换
- **Pass Condition**: pytest 多用户用例通过
- **Evidence**: `tests/test_chat_share.py` 权限用例

### AC-7: 异常选择给出原因且不生成链接
- **Type**: `rule`
- **Given**: 已登录用户与自己的会话
- **When**: 分别以（a）turns 为空数组、（b）不存在/伪造令牌、（c）先获取遗留令牌再删除该回合使下标/摘要失配、（d）仅含用户消息的不完整回合令牌请求分享
- **Then**: 均返回 400 且响应体包含可展示的具体原因；每种情况下 PublicConversation 数量不增加；前端在对话框内展示原因且无 URL 产出
- **Pass Condition**: 4 个后端场景 pytest 断言状态码、错误信息与公开记录计数；前端手工验证提示展示
- **Evidence**: `tests/test_chat_share.py` 错误路径用例；浏览器验证记录

### AC-8: 快照与源会话后续变更隔离
- **Type**: `rule`
- **Given**: 已生成选择性公开链接
- **When**: 源会话随后新增一个回合、删除一个已选回合、修改标题后再次请求公开历史
- **Then**: 公开快照消息与标题（title 字段复制自分享时刻）保持分享时内容不变
- **Pass Condition**: pytest 变更前后两次公开历史响应完全相等
- **Evidence**: `tests/test_chat_share.py` 快照隔离用例

### AC-9: 选择性快照支持 fork
- **Type**: `rule`
- **Given**: 已登录访问者打开选择性分享公开页并发送首条消息触发 fork
- **When**: POST /api/chat/share/fork
- **Then**: 在其账号下创建仅含所选回合的私有会话并返回 conversation_id，公开快照不变
- **Pass Condition**: pytest 断言新会话归属与消息集合
- **Evidence**: `tests/test_chat_share.py` fork 用例

### AC-10: 选择与预览体验质量
- **Type**: `rubric`
- **Dimension**: 选择对话框的可用性与信息完整性
- **Scale**: 1-5
- **Anchors**: 1 = 无法完成多选或预览内容缺失严重；3 = 可完成主流程但加载/勾选/预览有明显摩擦或部分工具结果不显示；5 = 加载、按回合勾选、不连续选择、即时预览、错误提示顺畅自然，引用/附件/工具结果渲染与正常聊天一致
- **Pass Threshold**: >= 4
- **Evidence**: 浏览器走查（桌面+移动宽度）与评审记录

### AC-11: 工程质量与回归保护
- **Type**: `rubric`
- **Dimension**: 测试覆盖、类型安全与构建健康
- **Scale**: 1-5
- **Anchors**: 1 = 无测试或构建失败；3 = 主路径有测试但错误路径缺失、lint 有警告；5 = 后端正常/错误/权限/隔离路径均有 pytest 覆盖且全部通过，前端 lint 与生产构建通过，无 TS 类型错误
- **Pass Threshold**: >= 4
- **Evidence**: pytest、next lint、next build（或 tsc --noEmit 降级方案）输出

## Open Questions
- 无阻塞问题。以下为实现期可自行决定的细节：对话框中"整段分享/选择分享"的具体交互形态（初始两个按钮或 Tab）；遗留组令牌摘要的精确序列化方式；不完整回合的灰显文案。
