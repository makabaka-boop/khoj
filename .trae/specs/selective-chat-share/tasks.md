# 按问答选择分享网页聊天 - 实施计划

任务按依赖排序；每个任务至少一个 TR。AC 覆盖矩阵：AC-1→T6/T5；AC-2→T4/T5；AC-3→T1/T2/T3/T6；AC-4→T1/T3/T6；AC-5→T3/T6；AC-6→T3/T6；AC-7→T1/T3/T4/T6；AC-8→T3/T6；AC-9→T6；AC-10→T4/T5/T7；AC-11→T6/T7。

## Task 1: 后端回合分组与选择令牌（纯逻辑）
- **Status**: `completed`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 在 `src/khoj/database/adapters/__init__.py` 的 `ConversationAdapters` 中新增静态方法：
    - `group_chat_messages_into_turns(messages: list[dict]) -> list[TurnGroup]`：单遍分组。带 `turnId` 的消息按 id 归组（保持首次出现顺序与组内原序）；无 turnId 消息在遇到 `by=="you"` 时开新遗留组，后续无 id 消息并入直到下一个用户消息或带 id 消息；开头孤立 khoj 消息单独成组。
    - TurnGroup 字段：`token`、`turn_id: Optional[str]`、`anchor_index: int`（组首条在原数组下标）、`messages: list[dict]`、`is_selectable: bool`（≥1 you 且 ≥1 非空 khoj 回答；空串/空白/空 list 视为空）。
    - 令牌：现代回合 `turn:<turnId>`；遗留回合 `legacy:<anchor_index>:<created或空串>:<anchor消息规范化JSON的sha256前12位>`（`json.dumps(..., sort_keys=True, ensure_ascii=False, default=str)`）。
    - `resolve_share_tokens(messages, tokens) -> (selected_messages, error)`：基于当前完整日志重新分组，去重后逐个解析——未知/格式错/遗留组下标与 created、摘要不匹配/组不可选→返回可读错误字符串（区分"所选问答已被删除或已变更"与"问答不完整，无法分享"）；成功返回按原日志顺序排列的消息并集。
  - 纯函数不触库、不修改入参（内部仅读取）。
- **Acceptance Criteria Addressed**: AC-3, AC-4, AC-7
- **Test Requirements**:
  - `rule` TR-1.1: 混合日志（现代回合 + 无 turnId 旧回合 + 开头孤立 khoj + 仅有提问的中断回合）分组数量、每组归属消息与 selectable 标记正确；证据：pytest 直接断言分组结果。
  - `rule` TR-1.2: 令牌在同一份日志上可往返解析；删除遗留组之前的一条消息制造下标漂移后，旧遗留令牌解析失败且错误信息指向"已删除/已变更"；turn 令牌在回合被删后解析失败；证据：pytest 断言。
  - `rule` TR-1.3: resolve 输出保持原日志相对顺序、去重、不修改入参 dict；证据：pytest 深拷贝对比。
- **Notes**: 中文错误信息需与 FR-9 一致、可直接展示。

## Task 2: GET /api/chat/history 响应回填 shareToken/turnSelectable
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 修改 [chat_history](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/khoj/routers/api_chat.py#L237-L299)：先对**完整** chat 数组分组（n 切片前），给每条消息的**响应副本**追加 `shareToken` 与 `turnSelectable` 两个字段；响应构造使用拷贝（dict/list 浅拷贝即可，不改写消息内部对象），杜绝向 conversation_log 内存对象写入新字段。
  - 无消息时行为不变；其余响应字段（conversation_id/slug/agent/is_owner）与 n 分页语义不变。
- **Acceptance Criteria Addressed**: AC-3
- **Test Requirements**:
  - `rule` TR-2.1: 带 n 与不带 n 请求时，返回的每条消息均带 shareToken，同一回合令牌相同、不完整回合 turnSelectable=false；证据：pytest。
  - `rule` TR-2.2: 请求后重新从 DB 读取 Conversation，conversation_log 中不存在 shareToken/turnSelectable 字段（源数据零污染）；证据：pytest refresh 后断言。
  - `rule` TR-2.3: n>0/n<0 分页切片结果与改动前一致（仅多两个字段）；证据：pytest 对照。

## Task 3: POST /api/chat/share 支持选择性快照
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - [duplicate_chat_history_public_conversation](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/khoj/routers/api_chat.py#L443-L476) 增加可选 JSON body 模型 `ShareConversationRequestBody(turns: Optional[list[str]] = None)`（`Body(None)` 形式，保持无 body 请求兼容）。
  - 会话不存在时返回 404（与前端错误处理一致）。
  - turns 缺省/None → 现有整段复制流程与返回体不变。
  - turns == [] → 400 `{"status":"error","message":"请至少选择一个问答后再分享"}`。
  - 否则调用 `resolve_share_tokens`：错误 → 400 + 具体 message；成功 → 扩展 [make_public_conversation_copy](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/khoj/database/adapters/__init__.py#L997-L1006) 增加可选 `messages` 参数，以 `{"chat": selected_messages}` 新建 PublicConversation（title/agent/slug 沿用源会话；消息用 copy 避免共享可变引用）。域名校验、遥测、URL 返回逻辑不变。
- **Acceptance Criteria Addressed**: AC-4, AC-5, AC-6, AC-7, AC-8
- **Test Requirements**:
  - `rule` TR-3.1: 不带 turns 的 POST 与改动前契约一致（全量消息、URL 可访问）；证据：pytest。
  - `rule` TR-3.2: 带合法 turns 时快照仅含所选回合消息、原顺序、字段完整（context/images/queryFiles/onlineContext/codeContext/trainOfThought 深相等）；证据：pytest。
  - `rule` TR-3.3: 空列表/坏令牌/失配令牌/不完整回合 → 400 且 PublicConversation 计数不增加；他人会话 → 404 且不增加；证据：pytest。
  - `rule` TR-3.4: 分享后修改源会话（新增/删除/改名）再次 GET 公开历史，响应（消息与 title）不变；证据：pytest。

## Task 4: 前端选择分享对话框组件
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 2, Task 3
- **Description**:
  - 新增 `src/interface/web/app/components/shareChat/shareChatDialog.tsx`（及按需 colocated CSS；优先 Tailwind/shadcn）：
    - props：`conversationId`、`open`/`onOpenChange`、成功回调（回传 url）。
    - 视图 1（方式选择）："分享整段对话"（调用现有整段分享）与"选择问答分享"；从菜单进入时默认显示该视图。
    - 视图 2（选择+预览）：按 chatHistory 同款递增 n 协议拉取 `/api/chat/history?conversation_id=...&n=page*PAGE_SIZE`（PAGE_SIZE 与现有 fetchMessageCount 一致=10），顶部"加载更早记录"按钮直至无更多；按相邻同 `shareToken` 分组渲染，每组首条（提问行）放 Checkbox，不可选组（`turnSelectable===false`）置灰并提示"问答不完整"；支持不连续多选与已选计数；提供"仅看所选"预览开关，预览仅渲染所选组、原顺序，khoj 消息的 trainOfThought 用现有 `TrainOfThoughtComponent` 风格展示（可复用 chatHistory 中的提取/展示组件，必要时导出复用），引用/附件/工具结果随 ChatMessage 自然渲染。
    - 确认按钮 0 选中时禁用；确认 POST `/api/chat/share` JSON body `{turns: tokens}`，成功→回传 url 进入现有 URL 弹窗；400/404→对话框内红色错误文案展示后端 message，不关闭弹窗。
  - 类型：扩展 [SingleChatMessage](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/interface/web/app/components/chatMessage/chatMessage.tsx#L163-L181) 增加可选 `shareToken?: string`、`turnSelectable?: boolean`。
- **Acceptance Criteria Addressed**: AC-2, AC-3, AC-10
- **Test Requirements**:
  - `rule` TR-4.1: 对话框在 n=10/20/... 直到 hasMore=false 的分页下能加载到最早消息，且不重复不遗漏；证据：浏览器走查 + 网络面板。
  - `rule` TR-4.2: 勾选按回合联动（问+答同时高亮），不连续选择计数与预览集合一致；0 选中时确认禁用；证据：浏览器走查。
  - `rule` TR-4.3: 后端返回 400 时弹窗内显示原因且无 URL；成功时 URL 弹窗可复制；证据：浏览器走查（可用拦截/构造失配令牌复现）。
  - `rubric` TR-4.4: 选择体验；scale 1-5；anchors 同 AC-10；threshold >= 4；证据：桌面与移动宽度走查记录。

## Task 5: ChatMessage 只读模式与分享菜单接线
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 4
- **Description**:
  - 给 [ChatMessage](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/interface/web/app/components/chatMessage/chatMessage.tsx#L279-L289) 增加可选 `readOnly?: boolean`（或等价 prop），为 true 时不渲染删除/重试/反馈等会话内操作按钮，其余渲染（正文、引用、图片、附件、online/code 上下文）不变；默认 false，保证现有调用零影响。
  - 改造 [ChatSessionActionMenu](file:///Users/zhangxinyu/SWE/tasks/SWE-0059-khoj/src/interface/web/app/components/allConversations/allConversations.tsx#L487-L689)：点击 Share 图标/菜单项打开新的 ShareChatDialog 替代"立即 POST"；对话框内"分享整段对话"复用现有 `shareConversation` 并展示原 URL 弹窗；保留重命名/删除菜单与尺寸变体（sm/md/lg）行为不变。
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-10
- **Test Requirements**:
  - `rule` TR-5.1: 侧边栏会话项（sm）与聊天页头部（md）均可打开对话框；整段分享生成 URL 正常；证据：浏览器走查。
  - `rule` TR-5.2: 预览与公开页中不出现删除/重试/反馈控件；正常聊天页这些控件仍存在；证据：浏览器走查 + 代码检查。
  - `rule` TR-5.3: 公开页所有者的取消分享按钮仍可删除快照并 404；证据：浏览器走查/pytest（T6 覆盖接口）。

## Task 6: 后端集成测试 tests/test_chat_share.py
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 1, Task 2, Task 3
- **Description**:
  - 新建测试文件，复用 `client`/`default_user` 夹具与 Bearer 认证；构造 Conversation（直接 ORM 写入 conversation_log，覆盖 turnId/无 turnId、含 context/images/queryFiles/onlineContext/codeContext/trainOfThought 的消息、不完整回合、开头孤立 khoj）。
  - 用例矩阵：整段分享回归；history 令牌回填与零污染；选择性快照内容/顺序/字段；share/history 四种 n 参数隔离；空/坏/失配/不完整令牌 400 且无公开记录；跨用户 404；快照隔离（源会话新增/删除/改名）；DELETE 取消分享后 404；fork 仅含所选且归属正确；未认证访问 share/history 200 且仅含所选。
  - 对 history 回填的令牌采用"GET 取令牌→POST 兑换"的真实链路，避免硬编码摘要。
- **Acceptance Criteria Addressed**: AC-1, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9
- **Test Requirements**:
  - `rule` TR-6.1: `pytest tests/test_chat_share.py -q` 全部通过；证据：命令输出。
  - `rule` TR-6.2: 用例数量覆盖上述全部矩阵（每个错误原因至少 1 例）；证据：测试清单评审。
  - `rubric` TR-6.3: 测试可读性与断言强度（精确到消息顺序与字段，而非仅状态码）；scale 1-5；anchors 1=仅测 200；3=主路径精确、错误路径粗略；5=矩阵完整且含负向计数/隔离断言；threshold >= 4；证据：代码评审。

## Task 7: 前端静态检查、构建与端到端走查
- **Status**: `in_progress`
- **Priority**: medium
- **Depends On**: Task 4, Task 5, Task 6
- **Description**:
  - 在 `src/interface/web` 运行 `bun run lint`（或 npx next lint）与 `bun run build`（若依赖未安装或环境受限，降级 `npx tsc --noEmit` 并在证据中注明）。
  - 后端运行 `pytest tests/test_chat_share.py` 与受影响路由器相关测试。
  - 浏览器端到端走查（本地起服务）：长会话分页加载→不连续勾选旧回合（无 turnId 数据可通过 ORM 构造）→预览（含引用/附件/工具结果）→确认→无痕窗口打开公开链接核对仅含所选→源会话继续聊天后公开链接不变→取消分享 404；再验证整段分享流程。
- **Acceptance Criteria Addressed**: AC-10, AC-11
- **Test Requirements**:
  - `rule` TR-7.1: lint/build（或降级 tsc）零错误；pytest 全绿；证据：命令输出归档。
  - `rule` TR-7.2: 端到端走查全部步骤通过，公开链接在未登录会话中仅展示所选回合；证据：走查记录/截图。
  - `rubric` TR-7.3: 整体完成质量对应 AC-11；scale 1-5；anchors 同 AC-11；threshold >= 4；证据：评审汇总。
