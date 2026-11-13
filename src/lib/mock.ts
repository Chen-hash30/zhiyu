import type {
  AppState,
  ApplyResult,
  Bootstrap,
  ChatListState,
  ChatMessage,
  ChatSendResult,
  ChatSession,
  ChatSessionMeta,
  ChatSource,
  CreateNoteResult,
  DeleteNoteResult,
  GitCommit,
  GitState,
  ImportOutcome,
  NoteDetail,
  NoteMeta,
  NoteType,
  OrganizePreview,
  PublicSettings,
  RevertResult,
  SettingsPatch,
  SingleImportResult,
  Stats,
  TrashEntry,
  ZhiyuApi,
} from '../types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const currentDate = '2026-11-13';

function stripMd(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function linksIn(markdown: string) {
  const found = new Set<string>();
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match;
  while ((match = re.exec(markdown))) found.add(match[1].trim());
  return [...found];
}

const TYPE_LABELS: Record<NoteType, string> = {
  raw: '资料',
  concept: '概念',
  entity: '实体',
  source: '来源',
  note: '笔记',
  system: '系统',
};

function makeNote(input: {
  path: string;
  title: string;
  type: NoteType;
  body: string;
  tags?: string[];
  aliases?: string[];
  status?: string;
  source?: string;
  author?: string;
  created: string;
  updated: string;
}): NoteDetail {
  const plain = stripMd(input.body);
  const cjk = (plain.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (plain.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  const excerpt = plain.length > 160 ? `${plain.slice(0, 160).trim()}…` : plain;
  return {
    path: input.path,
    title: input.title,
    type: input.type,
    typeLabel: TYPE_LABELS[input.type],
    tags: input.tags || [],
    aliases: input.aliases || [],
    created: input.created,
    updated: input.updated,
    excerpt,
    links: linksIn(input.body),
    status: input.status || (input.type === 'raw' ? 'inbox' : ''),
    source: input.source || '',
    author: input.author || '',
    processedAt: '',
    wikiPaths: [],
    wordCount: cjk + latin,
    readingMinutes: Math.max(1, Math.ceil(cjk / 400 + latin / 220)),
    body: input.body,
    data: {},
  };
}

const notes: NoteDetail[] = [
  makeNote({
    path: 'raw/2026-11-13-为什么写作是思考.md',
    title: '为什么写作是思考',
    type: 'raw',
    created: '2026-11-13T09:20:00',
    updated: '2026-11-13T09:20:00',
    source: 'https://sspai.com/post/writing-is-thinking',
    author: '少数派',
    tags: ['写作', '思考'],
    body: `写作不是把想清楚的东西记录下来，而是通过写，逼自己把模糊的直觉变成可检验的句子。

## 摘录

> 如果你不能把一个想法写成三段话，很可能你还没有真正理解它。

- 写作会暴露论证里的跳跃。口头表达可以靠语气和表情糊弄过去，文字不行。
- 每写一次，都是一次重新组织。旧笔记不是仓库，而是可以反复加工的素材。
- 公开写作会带来外部反馈，但即使不公开，写给未来的自己也有价值。

## 我的想法

这和 [[渐进式总结]] 的“用自己的话重写”是同一件事。也许应该把“是否写成一段话”作为判断一条笔记是否合格的标准，而不是看它收集了多少链接。

下一步：把 [[第二大脑]] 里“表达”这一节展开，补一个具体的写作流程。`,
  }),
  makeNote({
    path: 'raw/2026-11-12-Agent-记忆机制摘录.md',
    title: 'Agent 记忆机制摘录',
    type: 'raw',
    created: '2026-11-12T21:05:00',
    updated: '2026-11-12T21:05:00',
    source: 'https://www.anthropic.com/engineering/agent-memory',
    author: 'Anthropic 工程博客',
    tags: ['Agent', '记忆'],
    body: `# Agent 记忆机制摘录

来自一篇关于 Agent 工程的访谈，重点在“记忆应该如何分层”。

## 要点

- 上下文窗口不是记忆，只是工作台。把所有历史都塞进去，成本和噪声都会失控。
- 长期记忆需要写回机制：任务结束后，把结论写进文件，而不是指望下次还能想起来。
- 检索应该发生在任务开始前，而不是每轮对话都全量搜索。
- 记忆需要过期和冲突处理，否则错误会一直复利。

## 关联

这解释了为什么 [[智能体记忆]] 要区分工作记忆、情景记忆和语义记忆。也让我重新看待 [[检索增强生成]]：检索不是问答的装饰，而是 Agent 的基础设施。

可以试试：让 Agent 每次整理后更新一个“已知 / 未知”清单，减少重复提问。`,
  }),
  makeNote({
    path: 'raw/2026-11-09-知识管理的复利效应.md',
    title: '知识管理的复利效应',
    type: 'raw',
    created: '2026-11-09T18:30:00',
    updated: '2026-11-09T18:30:00',
    source: 'https://example.com/knowledge-compounding',
    tags: ['知识管理'],
    status: 'processed',
    body: `# 知识管理的复利效应

一篇旧文，讲为什么“连接”比“收藏”更重要。

## 摘录

知识的价值不是线性叠加，而是网络效应。当一条新笔记能和三条旧笔记建立联系时，你得到的不只是第四条笔记，而是四个更新过的理解节点。

## 我的批注

这直接支撑了 [[知识复利]] 的判断标准：知识库是否在帮你做出更好的判断。

也提醒我，整理时不要只追求条目数量。没有链接的条目，只是换了个地方存放。`,
  }),
  makeNote({
    path: 'wiki/concepts/第二大脑.md',
    title: '第二大脑',
    type: 'concept',
    created: '2026-11-02T10:00:00',
    updated: '2026-11-11T16:40:00',
    tags: ['知识管理', '方法论'],
    aliases: ['Second Brain'],
    body: `把记忆和思考交给一个可检索、可连接的外部系统，让人把注意力留给判断和创造。

## 它解决什么问题

人的工作记忆容量有限。读过的文章、开过的会、突然冒出的想法，如果没有一个稳定的落点，很快就会退化成“好像看过”。

第二大脑不是资料仓库，而是一套 **捕获—组织—提炼—表达** 的循环：

1. **捕获**：只记录会改变行动或判断的信息。
2. **组织**：让笔记彼此连接，而不是堆进文件夹。
3. **提炼**：用自己的话压缩，留下可以复用的观点。
4. **表达**：输出会反过来检验理解。

## 一个常见误区

把“收藏”当成“拥有”。真正的门槛不在输入，而在整理和重写。[[渐进式总结]] 提供了压缩的方法，[[知识复利]] 解释了为什么值得长期做。

## 可以怎么开始

先选一个足够小的主题，连续记录两周；工具用 [[Obsidian]] 或任何本地 Markdown 仓库都可以。关键不是软件，而是让笔记之间长出链接。`,
  }),
  makeNote({
    path: 'wiki/concepts/渐进式总结.md',
    title: '渐进式总结',
    type: 'concept',
    created: '2026-11-03T09:12:00',
    updated: '2026-11-12T10:15:00',
    tags: ['知识管理', '写作'],
    aliases: ['Progressive Summarization'],
    body: `渐进式总结是一种分层压缩笔记的方法：先保留原文，再逐层加粗、提炼、改写，直到留下真正可复用的结论。

## 四层结构

- **第一层**：完整摘录，保留上下文。
- **第二层**：加粗关键句，方便快速扫读。
- **第三层**：在页首写三行摘要。
- **第四层**：用自己的话重写成一条可引用的观点。

每次重读只做一层，不要求一次到位。这样整理的成本被摊薄，笔记也会随着理解加深而变得更短。

## 和第二大脑的关系

[[第二大脑]] 解决“放在哪里”，渐进式总结解决“留下什么”。两者结合，才能让资料从库存变成知识。

延伸阅读：[[卡片笔记写作法]]`,
  }),
  makeNote({
    path: 'wiki/concepts/知识复利.md',
    title: '知识复利',
    type: 'concept',
    created: '2026-11-04T14:30:00',
    updated: '2026-11-08T20:10:00',
    tags: ['知识管理', '决策'],
    aliases: ['Knowledge Compounding'],
    body: `知识复利指的是：当笔记之间建立连接后，新资料会不断激活旧笔记，理解的增长快于输入的速度。

## 复利从哪里来

- **连接**：一条新笔记和三条旧笔记相连，等于同时更新了四个理解节点。
- **重用**：写作、决策、汇报时反复调用同一批观点，边际成本越来越低。
- **校正**：旧结论被新证据修正，错误不会一直潜伏。

## 一个判断标准

如果你的知识库半年后还能帮你做出更好的判断，它就在产生复利；如果只是不断变大，那可能只是库存。

这与 [[第二大脑]] 的“表达”环节直接相关：输出是检验复利是否发生的唯一方式。`,
  }),
  makeNote({
    path: 'wiki/concepts/智能体记忆.md',
    title: '智能体记忆',
    type: 'concept',
    created: '2026-11-05T11:20:00',
    updated: '2026-11-12T22:10:00',
    tags: ['Agent', '记忆', '架构'],
    aliases: ['Agent Memory'],
    body: `智能体记忆是让 AI Agent 在多轮任务之间保留、检索并更新信息的机制。它决定了 Agent 能否从“一次性问答”变成“持续协作”。

## 三类记忆

- **工作记忆**：当前任务的上下文，随会话结束而消失。
- **情景记忆**：过去做过什么、结果如何，通常以事件或日志形式保存。
- **语义记忆**：稳定的事实、偏好和领域知识，常落在文件或知识库里。

## 常见做法

1. 把长期信息写成结构化文件，例如 Markdown 或 JSON。
2. 在每轮任务开始前检索相关片段，而不是把所有内容塞进上下文。
3. 任务结束后写回摘要，更新已有条目，避免重复堆积。

[[检索增强生成]] 解决“怎么找回来”，[[OpenClaw]] 这类本地 Agent 则提供读写文件与调用工具的运行环境。

## 风险

记忆不是越多越好。过期、冲突、未经确认的信息会污染后续判断，所以需要版本管理和人工复核。`,
  }),
  makeNote({
    path: 'wiki/concepts/检索增强生成.md',
    title: '检索增强生成',
    type: 'concept',
    created: '2026-11-06T16:00:00',
    updated: '2026-11-10T09:40:00',
    tags: ['AI', '检索', '架构'],
    aliases: ['RAG', 'Retrieval-Augmented Generation'],
    body: `检索增强生成（RAG）是在模型回答之前，先从外部知识库找出相关片段，再把片段放进上下文。

## 基本流程

1. 文档切分成可检索的小块。
2. 为每个块建立索引，常见做法是向量检索，也可以混合关键词检索。
3. 用户提问时召回最相关的若干块。
4. 模型基于这些块组织答案，并标注来源。

## 它适合什么

- 资料更新频繁，模型本身不可能记住。
- 回答需要引用出处，不能凭空生成。
- 知识属于个人或组织，不能上传到公共训练集。

对个人知识库来说，RAG 的价值不在“更聪明”，而在 **让回答落在自己真正读过的材料上**。[[RAGFlow]] 侧重文档解析，[[智能体记忆]] 则把检索放进更长的任务循环里。`,
  }),
  makeNote({
    path: 'wiki/entities/Obsidian.md',
    title: 'Obsidian',
    type: 'entity',
    created: '2026-10-28T09:00:00',
    updated: '2026-11-07T15:25:00',
    tags: ['工具', 'Markdown', '本地优先'],
    aliases: ['黑曜石笔记'],
    body: `Obsidian 是一款以本地 Markdown 文件为核心的笔记工具，强调双向链接和插件扩展。

## 适合谁

- 希望数据完全留在本机的人。
- 喜欢用文件、文件夹和链接组织知识的人。
- 愿意用插件拼出自己工作流的人。

## 关键能力

- **双向链接**：\`[[笔记名]]\` 自动形成反向索引。
- **关系图谱**：把链接可视化，发现知识簇和孤岛。
- **插件生态**：社区插件覆盖日历、看板、白板、AI 等场景。
- **本地优先**：笔记就是普通文件，不依赖云端账号。

在 [[第二大脑]] 的实践里，Obsidian 负责“存放和连接”，[[渐进式总结]] 负责“压缩”。它的核心不是功能多，而是文件格式足够开放。`,
  }),
  makeNote({
    path: 'wiki/entities/OpenClaw.md',
    title: 'OpenClaw',
    type: 'entity',
    created: '2026-11-01T13:10:00',
    updated: '2026-11-12T19:30:00',
    tags: ['AI', 'Agent', '开源'],
    aliases: ['OpenClaw Agent'],
    body: `OpenClaw 是一个开源的本地 AI Agent 平台，强调在本机运行、接入多种模型，并让 Agent 直接操作文件与工具。

## 能做什么

- 读取和写入本地 Markdown 文件。
- 按计划执行任务，例如整理资料、生成摘要、维护索引。
- 通过技能扩展外部工具和消息渠道。

## 适合的场景

把重复的整理工作交给 Agent，但保留文件的可见性和可回滚性。和纯聊天产品相比，它更像一个可以被你检查工作过程的助手。

在知识库里，OpenClaw 可以承担 [[智能体记忆]] 里的“执行层”：读资料、写条目、维护链接。是否值得引入，取决于你能否为它定下清晰的规则边界。`,
  }),
  makeNote({
    path: 'wiki/entities/RAGFlow.md',
    title: 'RAGFlow',
    type: 'entity',
    created: '2026-10-30T10:45:00',
    updated: '2026-11-09T17:20:00',
    tags: ['AI', 'RAG', '开源'],
    body: `RAGFlow 是一个开源的知识库问答引擎，强项在复杂文档解析：扫描件、表格、多栏 PDF 和图片中的文字。

## 它的位置

普通 RAG 系统往往把 PDF 当成纯文本，版面信息丢失后，表格和页眉页脚会污染检索结果。RAGFlow 用版面分析和 OCR 把文档还原成更干净的结构化内容。

## 适合谁

- 资料以 PDF、扫描件、合同、研报为主。
- 需要私有化部署，数据不能出内网。
- 团队里有人能维护 Docker 服务。

对个人知识库来说，它偏重；如果只是网页剪藏和 Markdown，[[Obsidian]] 这类文件型工具更轻。它和 [[检索增强生成]] 的关系，是把“召回质量”做扎实。`,
  }),
  makeNote({
    path: 'wiki/sources/打造第二大脑.md',
    title: '打造第二大脑',
    type: 'source',
    created: '2026-10-25T20:00:00',
    updated: '2026-11-06T21:15:00',
    tags: ['书籍', '知识管理'],
    body: `《打造第二大脑》把个人知识管理拆成捕获、组织、提炼、表达四个环节，强调“为了使用而记录”。

## 三个可带走的观点

1. 笔记的价值在于未来能否被再次调用，而不是记录时的完整程度。
2. 组织方式应该服务于项目，而不是追求一套完美的分类。
3. 表达是知识管理的最后一公里，没有输出就没有真正的理解。

## 我的批注

书里的方法偏向工作流，落地时仍需要一个稳定的文件结构。[[第二大脑]] 这条概念把它和 [[渐进式总结]] 连了起来。`,
  }),
  makeNote({
    path: 'wiki/sources/卡片笔记写作法.md',
    title: '卡片笔记写作法',
    type: 'source',
    created: '2026-10-22T18:00:00',
    updated: '2026-11-05T09:05:00',
    tags: ['书籍', '写作'],
    aliases: ['卡片盒笔记法'],
    body: `《卡片笔记写作法》介绍卢曼的卡片盒方法：把想法写成原子化卡片，通过编号和链接让主题自然生长。

## 核心原则

- 一张卡片只写一个想法。
- 用自己的话写，不复制原文。
- 卡片之间建立链接，而不是只按主题归档。
- 写作不是最后一步，而是思考发生的过程。

## 和渐进式总结的区别

卡片盒强调从零生成想法，[[渐进式总结]] 强调对已有材料逐层压缩。两者可以叠加：先压缩资料，再把结论写成卡片，最后汇入 [[第二大脑]]。`,
  }),
];

const systemNotes: Record<string, NoteDetail> = {
  'AGENTS.md': makeNote({
    path: 'AGENTS.md',
    title: '知屿整理规则',
    type: 'system',
    created: '2026-10-20T09:00:00',
    updated: '2026-11-12T09:00:00',
    body: `# 知屿整理规则

这份文件是知屿整理资料时遵循的规则。你可以直接修改它，下一次整理就会生效。

## 目录约定

- \`raw/\`：原始资料。网页剪藏、零散想法、导入的文件都从这里开始，只增不改。
- \`wiki/concepts/\`：概念。解释一个想法是什么、为什么重要、怎么用。
- \`wiki/entities/\`：实体。人物、产品、组织、书籍等具体对象。
- \`wiki/sources/\`：来源。对一份原始资料的要点总结与出处。
- \`index.md\`：知识索引，由知屿自动汇总。
- \`log.md\`：整理日志，由知屿自动追加。

## 写作原则

1. **忠于来源。** 只写资料里出现过的事实，不补常识，不编造数据。
2. **用自己的话。** 提炼而不是复制，长段落要压缩成可复用的结论。
3. **一件事一条。** 每条笔记只讲一个概念或一个对象，标题就是它的名字。
4. **优先合并。** 已有同名或同义条目时，在原条目上补充，不要重复创建。
5. **建立连接。** 用 \`[[条目名]]\` 连接相关概念，让知识之间可以互相看见。
6. **保持克制。** 正文通常 300–800 字，先写清楚，再写漂亮。`,
  }),
  'index.md': makeNote({
    path: 'index.md',
    title: '知识索引',
    type: 'system',
    created: '2026-10-20T09:00:00',
    updated: '2026-11-13T09:30:00',
    body: `# 知识索引

> 由知屿根据知识库内容自动汇总 · 更新于 2026-11-13 09:30

## 概念 · 5

- [[wiki/concepts/第二大脑|第二大脑]] — 把记忆和思考交给一个可检索、可连接的外部系统。
- [[wiki/concepts/渐进式总结|渐进式总结]] — 分层压缩笔记的方法。
- [[wiki/concepts/知识复利|知识复利]] — 连接让理解的增长快于输入。
- [[wiki/concepts/智能体记忆|智能体记忆]] — Agent 在任务之间保留与更新信息的机制。
- [[wiki/concepts/检索增强生成|检索增强生成]] — 先检索，再让模型基于资料回答。

## 实体 · 3

- [[wiki/entities/Obsidian|Obsidian]] — 本地 Markdown 笔记工具。
- [[wiki/entities/OpenClaw|OpenClaw]] — 开源本地 AI Agent 平台。
- [[wiki/entities/RAGFlow|RAGFlow]] — 擅长复杂文档解析的知识库引擎。

## 来源 · 2

- [[wiki/sources/打造第二大脑|打造第二大脑]]
- [[wiki/sources/卡片笔记写作法|卡片笔记写作法]]`,
  }),
  'log.md': makeNote({
    path: 'log.md',
    title: '整理日志',
    type: 'system',
    created: '2026-10-20T09:00:00',
    updated: '2026-11-13T09:30:00',
    body: `# 整理日志

- 2026-11-09 18:35 · 整理《知识管理的复利效应》· 更新 2 个条目
- 2026-11-11 16:42 · 整理《第二大脑》阅读笔记 · 更新 3 个条目
- 2026-11-12 22:14 · 整理《Agent 记忆机制摘录》· 新增 2 个条目
- 2026-11-13 09:30 · 自动汇总知识索引`,
  }),
};

const settings: PublicSettings = {
  theme: (new URLSearchParams(location.search).get('theme') as PublicSettings['theme']) || 'light',
  vaultPath: 'C:\\Users\\Zhiyu\\Documents\\山间笔记',
  recentVaults: ['C:\\Users\\Zhiyu\\Documents\\山间笔记'],
  windowBounds: null,
  gitAutoSnapshot: true,
  snapshotDir: '',
  mcpServers: [],
  ai: {
    preset: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    thinkingModel: 'deepseek-reasoner',
    contextWindow: 128000,
    autoCompress: true,
    hasKey: true,
  },
};

let chatSessions: ChatSession[] = [
  {
    id: 'session-welcome',
    title: '新对话',
    createdAt: `${currentDate}T09:00:00`,
    updatedAt: `${currentDate}T09:00:00`,
    messages: [],
  },
];
let activeChatId: string | null = 'session-welcome';
let trashEntries: TrashEntry[] = [
  {
    id: 'demo-trash',
    title: '旧草稿：注意力与深度工作',
    type: 'note',
    originalPath: 'wiki/notes/注意力与深度工作.md',
    fileName: 'demo-trash.md',
    deletedAt: `${currentDate}T08:40:00`,
  },
];
let pendingPreviews = new Map<string, OrganizePreview>();

const gitHistory: GitCommit[] = [
  { hash: 'c91f2a0', date: '2026-11-12 22:14', message: '整理：智能体记忆' },
  { hash: '7d3e8b1', date: '2026-11-11 16:42', message: '整理：第二大脑与渐进式总结' },
  { hash: '2a6c4f9', date: '2026-11-09 18:35', message: '整理：知识管理的复利效应' },
  { hash: 'f04b7d2', date: '2026-11-06 11:08', message: '初始化知识库' },
];

let gitState: GitState = {
  available: true,
  isRepo: true,
  latest: gitHistory[0],
  history: gitHistory,
};

function metaOf(note: NoteDetail): NoteMeta {
  const { body, data, ...meta } = note;
  return meta;
}

function allNotes() {
  return [...notes].sort((a, b) => {
    if (a.type === 'raw' && b.type !== 'raw') return -1;
    if (b.type === 'raw' && a.type !== 'raw') return 1;
    return b.updated.localeCompare(a.updated);
  });
}

function stats(): Stats {
  const weekAgo = new Date('2026-11-06T00:00:00').getTime();
  return {
    inbox: notes.filter((note) => note.type === 'raw' && note.status !== 'processed').length,
    total: notes.filter((note) => note.type !== 'raw').length,
    raw: notes.filter((note) => note.type === 'raw').length,
    week: notes.filter((note) => new Date(note.updated).getTime() >= weekAgo).length,
  };
}

function chatMetaOf(session: ChatSession): ChatSessionMeta {
  const last = [...session.messages].reverse().find((message) => message.content);
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    preview: last ? stripMd(last.content).slice(0, 80) : '',
    summary: session.summary || '',
    summaryCount: session.summaryCount || 0,
  };
}

function chatListState(): ChatListState {
  return {
    sessions: [...chatSessions]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(chatMetaOf),
    activeId: activeChatId,
  };
}

function activeChat(): ChatSession | null {
  return chatSessions.find((session) => session.id === activeChatId) || null;
}

function state(): AppState {
  const active = activeChat();
  return {
    vault: {
      path: settings.vaultPath || 'C:\\Users\\Zhiyu\\Documents\\山间笔记',
      name: '山间笔记',
      stats: stats(),
    },
    notes: allNotes().map(metaOf),
    settings: { ...settings },
    recentVaults: [...settings.recentVaults],
    git: { ...gitState, history: [...gitState.history] },
    chat: active?.messages.map((message) => ({ ...message })) || [],
    chatSessions: chatListState().sessions,
    activeChatId,
    trashCount: trashEntries.length,
  };
}

function findNote(notePath: string) {
  if (systemNotes[notePath]) return systemNotes[notePath];
  return notes.find((note) => note.path === notePath);
}

function refreshNote(note: NoteDetail, patch: Partial<NoteDetail>): NoteDetail {
  return makeNote({
    path: note.path,
    title: patch.title ?? note.title,
    type: note.type,
    body: patch.body ?? note.body,
    tags: patch.tags ?? note.tags,
    aliases: patch.aliases ?? note.aliases,
    status: patch.status ?? note.status,
    source: patch.source ?? note.source,
    author: patch.author ?? note.author,
    created: note.created,
    updated: patch.updated ?? note.updated,
  });
}

function slugify(input: string) {
  return (
    input
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 64) || '未命名'
  );
}

function uniquePath(folder: string, slug: string) {
  let candidate = `${folder}/${slug}.md`;
  let index = 2;
  while (notes.some((note) => note.path === candidate)) {
    candidate = `${folder}/${slug}-${index}.md`;
    index += 1;
  }
  return candidate;
}

const listeners = new Map<string, Set<(payload: unknown) => void>>();

function emit(channel: string, payload: unknown) {
  listeners.get(channel)?.forEach((callback) => callback(payload));
}

function subscribe(channel: string, callback: (payload: unknown) => void) {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel)!.add(callback);
  return () => listeners.get(channel)?.delete(callback);
}

function chatAnswer(question: string): { content: string; sources: ChatSource[] } {
  if (/收件箱|待整理/.test(question)) {
    const pending = notes.filter((note) => note.type === 'raw' && note.status !== 'processed');
    return {
      content: `当前收件箱里有 ${pending.length} 份待整理资料：

${pending
  .map((note, index) => `${index + 1}. **${note.title}** — ${note.excerpt}`)
  .join('\n\n')}

你可以在收件箱里选中任意一篇，点「AI 整理」把它们变成概念、实体和来源条目。`,
      sources: pending.map((note) => ({
        path: note.path,
        title: note.title,
        type: 'raw' as NoteType,
      })),
    };
  }
  if (/记忆|agent|智能体/i.test(question)) {
    return {
      content: `在你的知识库里，智能体记忆被分成三层：工作记忆、情景记忆和语义记忆。

- **工作记忆**是当前任务的上下文，会话结束就消失。
- **情景记忆**记录做过什么、结果如何，通常以日志或事件保存。
- **语义记忆**是稳定的事实和领域知识，适合放在文件里长期维护。

你的摘录里还提到两个关键点：记忆需要写回机制，否则下次仍然想不起来；检索应该发生在任务开始前，而不是每轮都全量搜索。这也解释了它和 [[检索增强生成]] 的关系。

一个可以马上做的改进：每次整理后更新一份“已知 / 未知”清单，减少重复提问。`,
      sources: [
        { path: 'wiki/concepts/智能体记忆.md', title: '智能体记忆', type: 'concept' },
        { path: 'wiki/concepts/检索增强生成.md', title: '检索增强生成', type: 'concept' },
        { path: 'raw/2026-11-12-Agent-记忆机制摘录.md', title: 'Agent 记忆机制摘录', type: 'raw' },
      ],
    };
  }
  if (/第二大脑|总结|写作/.test(question)) {
    return {
      content: `你的知识库里，[[第二大脑]] 和 [[渐进式总结]] 是一组互补关系：

- **第二大脑**解决“放在哪里”：捕获、组织、提炼、表达。
- **渐进式总结**解决“留下什么”：先保留原文，再逐层压缩成自己的话。

你在《为什么写作是思考》里记的那个判断很关键：如果不能把一个想法写成三段话，可能还没有真正理解它。这正好是渐进式总结的第四层，也是第二大脑的“表达”环节。

实践上，可以先从一份资料开始：摘录 → 加粗关键句 → 页首摘要 → 用自己的话重写。写不出来时，不要继续收藏，回到原文补理解。`,
      sources: [
        { path: 'wiki/concepts/第二大脑.md', title: '第二大脑', type: 'concept' },
        { path: 'wiki/concepts/渐进式总结.md', title: '渐进式总结', type: 'concept' },
        { path: 'wiki/concepts/知识复利.md', title: '知识复利', type: 'concept' },
      ],
    };
  }
  return {
    content: `从你的知识库来看，最相关的是 [[第二大脑]] 和 [[知识复利]]。

你记录的核心判断是：知识的价值不在数量，而在连接和重用。当一条新笔记能和旧笔记建立联系时，增长就不再是线性的。

如果要把这个结论落到行动上，可以从两件事开始：每次整理只问“它和我已经知道的什么有关”，以及每周重写一条旧笔记。前者增加连接，后者检验理解。`,
    sources: [
      { path: 'wiki/concepts/第二大脑.md', title: '第二大脑', type: 'concept' },
      { path: 'wiki/concepts/知识复利.md', title: '知识复利', type: 'concept' },
    ],
  };
}

export const mockApi: ZhiyuApi = {
  isElectron: false,
  app: {
    bootstrap: async () => {
      await sleep(100);
      const empty = new URLSearchParams(location.search).get('empty') === '1';
      const result: Bootstrap = {
        app: { name: '知屿', version: '1.0.0', platform: 'win32' },
        dataDir: 'C:\\Users\\Zhiyu\\AppData\\Roaming\\知屿',
        ...state(),
      };
      if (empty) {
        result.vault = null;
        result.notes = [];
        result.recentVaults = [];
        result.git = { available: true, isRepo: false, history: [] };
        result.chat = [];
        result.chatSessions = [];
        result.activeChatId = null;
        result.trashCount = 0;
      }
      return result;
    },
    chooseFolder: async () => {
      await sleep(260);
      return 'C:\\Users\\Zhiyu\\Documents';
    },
    defaultLocation: async () => 'C:\\Users\\Zhiyu\\Documents',
    revealVault: async () => {},
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    openFolder: async () => {},
    version: async () => '1.0.0',
    getDataInfo: async () => ({
      current: 'C:\\Users\\Zhiyu\\AppData\\Roaming\\知屿',
      defaultDir: 'C:\\Users\\Zhiyu\\AppData\\Roaming\\知屿',
    }),
    setDataDir: async (dataDir) => ({ restartRequired: true, dataDir }),
    relaunch: async () => {},
  },
  vault: {
    create: async (parentPath, name) => {
      await sleep(650);
      settings.vaultPath = `${parentPath}\\${name}`;
      settings.recentVaults = [settings.vaultPath, ...settings.recentVaults.filter((item) => item !== settings.vaultPath)];
      notes.length = 0;
      notes.push(
        makeNote({
          path: `raw/${currentDate}-欢迎来到知屿.md`,
          title: '欢迎来到知屿',
          type: 'raw',
          created: `${currentDate}T15:40:00`,
          updated: `${currentDate}T15:40:00`,
          source: '知屿',
          tags: ['开始'],
          body: `这里的每一条知识，都从一份原始资料开始。

把网页链接、零散想法或已有的 Markdown 文件放进收件箱。选中它们，交给 AI 按你的规则整理成概念、实体和来源摘要。

## 三个小建议

- **先预览，再写入。** 每次整理都会展示将要新增或更新的条目。
- **让笔记互相认识。** 用 [[双向链接]] 把相关的概念连起来。
- **随时可以回到过去。** 每次整理都会在 Git 里留下一个快照。`,
        }),
      );
      chatSessions = [
        {
          id: 'session-welcome',
          title: '新对话',
          createdAt: `${currentDate}T15:40:00`,
          updatedAt: `${currentDate}T15:40:00`,
          messages: [],
        },
      ];
      activeChatId = 'session-welcome';
      trashEntries = [];
      gitState = { available: true, isRepo: true, latest: null, history: [] };
      const base = state();
      return { ...base, vault: { ...base.vault!, name } };
    },
    open: async (targetPath) => {
      await sleep(420);
      if (targetPath) {
        settings.vaultPath = targetPath;
        settings.recentVaults = [targetPath, ...settings.recentVaults.filter((item) => item !== targetPath)];
      }
      return state();
    },
    move: async (targetParent) => {
      await sleep(900);
      const name = settings.vaultPath?.split(/[\\/]/).pop() || '山间笔记';
      settings.vaultPath = `${targetParent}\\${name}`;
      settings.recentVaults = [settings.vaultPath];
      return state();
    },
    refresh: async () => state(),
  },
  notes: {
    list: async () => allNotes().map(metaOf),
    read: async (notePath) => {
      await sleep(80);
      const note = findNote(notePath);
      if (!note) throw new Error('这条笔记不存在');
      return { ...note, data: {} };
    },
    save: async (notePath, patch) => {
      await sleep(160);
      const note = findNote(notePath);
      if (!note) throw new Error('这条笔记不存在');
      if (note.type === 'system') {
        note.body = patch.body ?? note.body;
        note.updated = `${currentDate}T15:58:00`;
        return { ...note };
      }
      const next = refreshNote(note, {
        ...patch,
        updated: `${currentDate}T15:58:00`,
      });
      const index = notes.findIndex((item) => item.path === notePath);
      notes[index] = next;
      return { ...next };
    },
    create: async (input) => {
      await sleep(220);
      const folder =
        input.type === 'entity' ? 'entities' : input.type === 'source' ? 'sources' : 'concepts';
      const path = uniquePath(`wiki/${folder}`, slugify(input.title));
      const note = makeNote({
        path,
        title: input.title,
        type: input.type as NoteType,
        body: input.body || '',
        tags: input.tags || [],
        created: `${currentDate}T15:56:00`,
        updated: `${currentDate}T15:56:00`,
      });
      notes.unshift(note);
      const result: CreateNoteResult = {
        note: { ...note, data: {} },
        notes: allNotes().map(metaOf),
        stats: stats(),
      };
      return result;
    },
    remove: async (notePath) => {
      await sleep(180);
      const index = notes.findIndex((note) => note.path === notePath);
      if (index >= 0) {
        const note = notes[index];
        notes.splice(index, 1);
        const entry: TrashEntry = {
          id: `trash-${Date.now()}`,
          title: note.title,
          type: note.type,
          originalPath: note.path,
          fileName: `trash-${Date.now()}.md`,
          deletedAt: `${currentDate}T16:20:00`,
        };
        trashEntries.unshift(entry);
      }
      const result: DeleteNoteResult = {
        notes: allNotes().map(metaOf),
        stats: stats(),
        trashCount: trashEntries.length,
      };
      return result;
    },
    reveal: async () => {},
  },
  trash: {
    list: async () => [...trashEntries],
    count: async () => trashEntries.length,
    restore: async (id) => {
      await sleep(220);
      const entry = trashEntries.find((item) => item.id === id);
      if (!entry) throw new Error('回收站里没有这条笔记');
      const note = makeNote({
        path: entry.originalPath,
        title: entry.title,
        type: entry.type,
        body: '这条笔记已从回收站恢复。',
        created: `${currentDate}T08:00:00`,
        updated: `${currentDate}T16:22:00`,
      });
      notes.unshift(note);
      trashEntries = trashEntries.filter((item) => item.id !== id);
      return {
        path: note.path,
        title: note.title,
        notes: allNotes().map(metaOf),
        stats: stats(),
      };
    },
    remove: async (id) => {
      await sleep(140);
      trashEntries = trashEntries.filter((item) => item.id !== id);
      return [...trashEntries];
    },
    empty: async () => {
      await sleep(160);
      trashEntries = [];
      return [];
    },
  },
  chat: {
    list: async () => chatListState(),
    get: async (id) => chatSessions.find((session) => session.id === id) || null,
    create: async (title) => {
      await sleep(100);
      const stamp = `${currentDate}T16:25:00`;
      const session: ChatSession = {
        id: `session-${Date.now()}`,
        title: title || '新对话',
        createdAt: stamp,
        updatedAt: stamp,
        messages: [],
        summary: '',
        summaryCount: 0,
      };
      chatSessions.unshift(session);
      activeChatId = session.id;
      return session;
    },
    select: async (id) => {
      await sleep(80);
      const session = chatSessions.find((item) => item.id === id);
      if (!session) throw new Error('这条对话不存在');
      activeChatId = id;
      return session;
    },
    rename: async (id, title) => {
      await sleep(100);
      const session = chatSessions.find((item) => item.id === id);
      if (!session) throw new Error('这条对话不存在');
      session.title = title.trim() || '新对话';
      session.updatedAt = `${currentDate}T16:26:00`;
      return chatMetaOf(session);
    },
    remove: async (id) => {
      await sleep(140);
      chatSessions = chatSessions.filter((session) => session.id !== id);
      if (activeChatId === id) activeChatId = chatSessions[0]?.id || null;
      return {
        ...chatListState(),
        messages: activeChat()?.messages || [],
      };
    },
    clear: async (id) => {
      await sleep(100);
      const session = chatSessions.find((item) => item.id === id);
      if (!session) throw new Error('这条对话不存在');
      session.messages = [];
      session.title = '新对话';
      session.summary = '';
      session.summaryCount = 0;
      session.updatedAt = `${currentDate}T16:27:00`;
      return chatMetaOf(session);
    },
    compress: async (id) => {
      await sleep(500);
      const session = chatSessions.find((item) => item.id === id);
      if (!session) throw new Error('这条对话不存在');
      const keepRecent = 6;
      const end = Math.max(0, session.messages.length - keepRecent);
      const start = Math.max(0, session.summaryCount || 0);
      if (end <= start) throw new Error('最近的消息还不够多，暂时不需要压缩。');
      session.summary = `此前对话摘要：用户希望把知屿作为个人知识库使用，讨论了收件箱、Agent 工具和上下文管理。已确认需要保留来源，并优先使用本地笔记回答。`;
      session.summaryCount = end;
      session.updatedAt = `${currentDate}T16:30:00`;
      return {
        session: { ...session },
        meta: chatMetaOf(session),
        sessions: chatListState().sessions,
      };
    },
  },
  raw: {
    promote: async (notePath) => {
      await sleep(300);
      const raw = findNote(notePath);
      if (!raw) throw new Error('资料不存在');
      raw.status = 'processed';
      const path = uniquePath('wiki/sources', slugify(raw.title));
      const note = makeNote({
        path,
        title: raw.title,
        type: 'source',
        body: raw.body,
        tags: raw.tags,
        source: raw.path,
        created: `${currentDate}T16:10:00`,
        updated: `${currentDate}T16:10:00`,
      });
      notes.unshift(note);
      return {
        path,
        title: raw.title,
        created: true,
        notes: allNotes().map(metaOf),
        stats: stats(),
        git: { available: true, isRepo: true, history: [] },
        gitCommitted: false,
      };
    },
    importText: async (input) => {
      await sleep(260);
      const path = uniquePath('raw', `${currentDate}-${slugify(input.title)}`);
      const note = makeNote({
        path,
        title: input.title || '未命名资料',
        type: 'raw',
        body: input.content,
        tags: input.tags || [],
        source: input.source || '',
        created: `${currentDate}T15:52:00`,
        updated: `${currentDate}T15:52:00`,
      });
      notes.unshift(note);
      const result: SingleImportResult = {
        note: { ...note, data: {} },
        notes: allNotes().map(metaOf),
        stats: stats(),
      };
      return result;
    },
    importUrl: async (url) => {
      await sleep(900);
      const note = makeNote({
        path: `raw/${currentDate}-为什么我们记不住读过的书.md`,
        title: '为什么我们记不住读过的书',
        type: 'raw',
        source: url,
        author: '网页剪藏',
        tags: ['阅读'],
        created: `${currentDate}T15:52:00`,
        updated: `${currentDate}T15:52:00`,
        body: `阅读留下的不是内容，而是被重新组织过的理解。

## 摘录

一本书读完，能复述出来的往往只有几个画面。不是记忆力差，而是大部分内容从来没有和已有的知识发生连接。

- 不做笔记的阅读，等于把材料临时放进工作记忆。
- 用自己的话写摘要，会强迫大脑重新编码。
- 间隔重读比一次性读完更有效。

这解释了为什么 [[渐进式总结]] 值得反复做：每一次压缩，都是在给内容一个新的落点。`,
      });
      notes.unshift(note);
      const result: SingleImportResult = {
        note: { ...note, data: {} },
        notes: allNotes().map(metaOf),
        stats: stats(),
      };
      return result;
    },
    importDialog: async () => {
      await sleep(500);
      const note = makeNote({
        path: `raw/${currentDate}-旧笔记-注意力与深度工作.md`,
        title: '旧笔记：注意力与深度工作',
        type: 'raw',
        created: `${currentDate}T15:54:00`,
        updated: `${currentDate}T15:54:00`,
        source: 'C:\\Users\\Zhiyu\\Documents\\旧笔记.md',
        tags: ['注意力'],
        body: `注意力不是一种态度，而是一种被环境塑造的能力。

## 三件事

1. 把最需要思考的任务放在一天里最清醒的时段。
2. 减少任务切换，切换的成本比想象中高。
3. 给输入留出空白，否则只是在搬运别人的结论。

和 [[第二大脑]] 的关系：外部系统负责记住，大脑负责判断。两者混在一起，注意力就会被不断打断。`,
      });
      notes.unshift(note);
      const outcome: ImportOutcome = {
        imported: [metaOf(note)],
        failed: [],
        canceled: false,
        notes: allNotes().map(metaOf),
        stats: stats(),
      };
      return outcome;
    },
    importPaths: async () => {
      return mockApi.raw.importDialog();
    },
  },
  ai: {
    cancelOrganize: async () => ({ ok: true }),
    organize: async (paths) => {
      const rawPath = paths[0];
      const raw = findNote(rawPath);
      if (!raw) throw new Error('请先选择要整理的资料');
      emit('organize:progress', { current: 1, total: paths.length, title: raw.title });
      await sleep(900);
      const existing = notes.find((note) => note.path === 'wiki/concepts/渐进式总结.md')!;
      const updatedBody = `${existing.body}

## 写作作为检验

如果一段总结不能用三句话讲清楚，说明还没有真正理解。写作会暴露论证里的跳跃，也迫使你重新组织素材。这与 [[第二大脑]] 的“表达”环节一致，也让 [[渐进式总结]] 从整理方法变成理解方法。`;
      const writingConcept = makeNote({
        path: 'wiki/concepts/写作即思考.md',
        title: '写作即思考',
        type: 'concept',
        created: `${currentDate}T16:00:00`,
        updated: `${currentDate}T16:00:00`,
        tags: ['写作', '思考'],
        aliases: ['Writing to Think'],
        body: `写作不是思考之后的记录，而是思考发生的过程。

## 为什么有效

- 写作要求把模糊的直觉变成可检验的句子。
- 论证里的跳跃，在落笔时会暴露出来。
- 每写一次，都是对素材的重新组织。

## 一个可操作的标准

如果一条笔记不能用自己的话写成三段，它可能还停留在“收藏”阶段。这也意味着，[[渐进式总结]] 的最后一层不是格式要求，而是理解的检验。

写作的输出会反过来改变输入：你会更清楚自己真正需要读什么。`,
      });
      const sourcePage = makeNote({
        path: 'wiki/sources/为什么写作是思考.md',
        title: '为什么写作是思考',
        type: 'source',
        created: `${currentDate}T16:00:00`,
        updated: `${currentDate}T16:00:00`,
        tags: ['写作', '来源'],
        source: 'https://sspai.com/post/writing-is-thinking',
        body: `## 核心观点

写作是思考的工具，而不是思考的结果。把想法写成可检验的句子，会暴露论证中的跳跃，并迫使作者重新组织素材。

## 三个要点

1. 口头表达可以靠语气遮掩，文字不行。
2. 旧笔记是可以反复加工的素材，不是静态仓库。
3. “能否写成三段话”可以作为检验理解的标准。

## 相关条目

[[写作即思考]] · [[渐进式总结]] · [[第二大脑]]`,
      });
      const diff = `--- wiki/concepts/渐进式总结.md
+++ wiki/concepts/渐进式总结.md
@@ -22,3 +22,9 @@
 [[第二大脑]] 解决“放在哪里”，渐进式总结解决“留下什么”。两者结合，才能让资料从库存变成知识。
 
 延伸阅读：[[卡片笔记写作法]]
+
+## 写作作为检验
+
+如果一段总结不能用三句话讲清楚，说明还没有真正理解。写作会暴露论证里的跳跃，也迫使你重新组织素材。这与 [[第二大脑]] 的“表达”环节一致，也让 [[渐进式总结]] 从整理方法变成理解方法。`;
      const preview: OrganizePreview = {
        id: `preview-${Date.now()}`,
        proposals: [
          {
            rawPath: raw.path,
            rawTitle: raw.title,
            summary: '写作既是表达，也是检验理解的方式；它与渐进式总结的最后一层直接相关。',
            log: `整理《${raw.title}》· 新增 2 个条目，更新 1 个条目`,
            pages: [
              {
                path: writingConcept.path,
                type: 'concept',
                title: writingConcept.title,
                action: 'create',
                body: writingConcept.body,
                diff: '',
                aliases: writingConcept.aliases,
                tags: writingConcept.tags,
              },
              {
                path: existing.path,
                type: existing.type,
                title: existing.title,
                action: 'update',
                body: updatedBody,
                diff,
                aliases: existing.aliases,
                tags: existing.tags,
              },
              {
                path: sourcePage.path,
                type: 'source',
                title: sourcePage.title,
                action: 'create',
                body: sourcePage.body,
                diff: '',
                aliases: [],
                tags: sourcePage.tags,
              },
            ],
          },
        ],
        stats: { pages: 3, creates: 2, updates: 1 },
      };
      pendingPreviews.set(preview.id, preview);
      return preview;
    },
    applyOrganize: async (id) => {
      await sleep(700);
      const preview = pendingPreviews.get(id);
      if (!preview) throw new Error('这次整理已经过期，请重新发起');
      const written: string[] = [];
      for (const proposal of preview.proposals) {
        for (const page of proposal.pages) {
          const existingIndex = notes.findIndex((note) => note.path === page.path);
          if (existingIndex >= 0) {
            notes[existingIndex] = refreshNote(notes[existingIndex], {
              body: page.body,
              tags: [...new Set([...notes[existingIndex].tags, ...page.tags])],
              aliases: [...new Set([...notes[existingIndex].aliases, ...page.aliases])],
              updated: `${currentDate}T16:02:00`,
            });
          } else {
            notes.unshift(
              makeNote({
                path: page.path,
                title: page.title,
                type: page.type,
                body: page.body,
                tags: page.tags,
                aliases: page.aliases,
                created: `${currentDate}T16:02:00`,
                updated: `${currentDate}T16:02:00`,
              }),
            );
          }
          written.push(page.path);
        }
        const rawIndex = notes.findIndex((note) => note.path === proposal.rawPath);
        if (rawIndex >= 0) {
          notes[rawIndex] = refreshNote(notes[rawIndex], {
            status: 'processed',
            updated: `${currentDate}T16:02:00`,
          });
        }
      }
      pendingPreviews.delete(id);
      const commit: GitCommit = {
        hash: Math.random().toString(16).slice(2, 9),
        date: '2026-11-13 16:02',
        message: `整理：${preview.proposals.map((item) => item.rawTitle).join('、')}`,
      };
      gitState = {
        ...gitState,
        latest: commit,
        history: [commit, ...gitState.history],
      };
      const result: ApplyResult = {
        written,
        gitCommitted: true,
        warning: '',
        notes: allNotes().map(metaOf),
        stats: stats(),
        git: gitState,
      };
      return result;
    },
    chat: async (messages, requestId, options = {}) => {
      const last = [...messages].reverse().find((message) => message.role === 'user');
      const question = last?.content || '';
      let session = options.sessionId
        ? chatSessions.find((item) => item.id === options.sessionId)
        : activeChat();
      if (!session) {
        const stamp = `${currentDate}T16:25:00`;
        session = {
          id: `session-${Date.now()}`,
          title: '新对话',
          createdAt: stamp,
          updatedAt: stamp,
          messages: [],
        };
        chatSessions.unshift(session);
        activeChatId = session.id;
      }
      if (options.agentId && options.agentId !== 'chat' && /收件箱|待整理/.test(question)) {
        emit('chat:tool', { requestId, label: '查看收件箱', status: 'done' });
        emit('chat:agent', {
          requestId,
          type: 'thinking',
          id: 'mock-thought',
          content: '先查看收件箱，确认当前待整理的资料清单。',
        });
        emit('chat:agent', {
          requestId,
          type: 'tool',
          id: 'mock-tool-inbox',
          tool: 'list_inbox',
          label: '查看收件箱',
          status: 'running',
          args: {},
        });
        await sleep(220);
        emit('chat:agent', {
          requestId,
          type: 'tool',
          id: 'mock-tool-inbox',
          tool: 'list_inbox',
          label: '查看收件箱',
          status: 'done',
          detail: '已读取当前收件箱中的待整理资料。',
        });
        emit('chat:agent', {
          requestId,
          type: 'thinking-delta',
          delta: '已获取收件箱清单，开始整理并回答。',
        });
      }
      const { content, sources } = chatAnswer(question);
      const chunks = Array.from(content);
      for (let i = 0; i < chunks.length; i += 4) {
        emit('chat:delta', { requestId, delta: chunks.slice(i, i + 4).join('') });
        await sleep(14);
      }
      const assistant: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content,
        sources,
        createdAt: `${currentDate}T16:05:00`,
      };
      session.messages = [...messages, assistant];
      session.updatedAt = `${currentDate}T16:05:00`;
      if (!session.title || session.title === '新对话') {
        const firstUser = messages.find((message) => message.role === 'user');
        session.title = firstUser
          ? stripMd(firstUser.content).slice(0, 28) || '新对话'
          : '新对话';
      }
      activeChatId = session.id;
      return {
        content,
        sources,
        sessionId: session.id,
        sessionTitle: session.title,
        session: chatMetaOf(session),
      };
    },
    loadChat: async () => activeChat()?.messages || [],
    clearChat: async () => {
      const session = activeChat();
      if (session) {
        session.messages = [];
        session.title = '新对话';
      }
      return [];
    },
    testConnection: async (input) => {
      await sleep(900);
      if ((input.baseUrl || settings.ai.baseUrl).includes('wrong')) {
        throw new Error('接口地址或模型名称不对，请检查设置。');
      }
      return { ok: true, message: '连接成功', models: ['deepseek-chat', 'deepseek-reasoner'] };
    },
  },
  mcp: {
    status: async () => ({ servers: [], tools: [], errors: [] }),
    refresh: async () => ({ servers: [], tools: [], errors: [] }),
  },
  rag: {
    status: async () => ({
      ready: true,
      building: false,
      model: 'bge-small-zh-v1.5',
      bundled: true,
      notes: 6,
      chunks: 18,
      builtAt: `${currentDate}T09:00:00`,
      progress: null,
    }),
    build: async () => ({
      ready: true,
      building: false,
      model: 'bge-small-zh-v1.5',
      bundled: true,
      notes: 6,
      chunks: 18,
      builtAt: `${currentDate}T09:00:00`,
      progress: null,
    }),
    cancel: async () => ({ ok: true }),
  },
  settings: {
    update: async (patch: SettingsPatch) => {
      await sleep(160);
      if (patch.theme) settings.theme = patch.theme;
      if (typeof patch.gitAutoSnapshot === 'boolean') settings.gitAutoSnapshot = patch.gitAutoSnapshot;
      if (typeof patch.snapshotDir === 'string') settings.snapshotDir = patch.snapshotDir;
      if (Array.isArray(patch.mcpServers)) settings.mcpServers = patch.mcpServers;
      if (patch.ai) {
        if (patch.ai.preset) settings.ai.preset = patch.ai.preset;
        if (patch.ai.baseUrl) settings.ai.baseUrl = patch.ai.baseUrl;
        if (patch.ai.model) settings.ai.model = patch.ai.model;
        if (typeof patch.ai.thinkingModel === 'string') {
          settings.ai.thinkingModel = patch.ai.thinkingModel;
        }
        if (typeof patch.ai.contextWindow === 'number') {
          settings.ai.contextWindow = patch.ai.contextWindow;
        }
        if (typeof patch.ai.autoCompress === 'boolean') {
          settings.ai.autoCompress = patch.ai.autoCompress;
        }
        if (patch.ai.apiKey) settings.ai.hasKey = true;
        if (patch.ai.clearKey) settings.ai.hasKey = false;
      }
      return { ...settings };
    },
  },
  git: {
    init: async () => {
      gitState = { available: true, isRepo: true, latest: null, history: [] };
      return gitState;
    },
    snapshot: async (message) => {
      const commit: GitCommit = {
        hash: Math.random().toString(16).slice(2, 9),
        date: '2026-11-13 16:08',
        message: message || '手动快照',
      };
      gitState = { ...gitState, latest: commit, history: [commit, ...gitState.history] };
      return gitState;
    },
    history: async () => gitState.history,
    revert: async (hash) => {
      const commit: GitCommit = {
        hash: Math.random().toString(16).slice(2, 9),
        date: '2026-11-13 16:10',
        message: `撤销：${gitState.history.find((item) => item.hash === hash)?.message || hash}`,
      };
      gitState = { ...gitState, latest: commit, history: [commit, ...gitState.history] };
      const result: RevertResult = {
        git: gitState,
        notes: allNotes().map(metaOf),
        stats: stats(),
      };
      return result;
    },
  },
  window: {
    minimize: async () => {},
    toggleMaximize: async () => false,
    close: async () => {},
    isMaximized: async () => false,
    onMaximizedChange: () => () => {},
  },
  events: {
    onVaultChanged: () => () => {},
    onOrganizeProgress: (callback) =>
      subscribe('organize:progress', callback as (payload: unknown) => void),
    onChatDelta: (callback) => subscribe('chat:delta', callback as (payload: unknown) => void),
    onChatTool: (callback) => subscribe('chat:tool', callback as (payload: unknown) => void),
    onAgent: (callback) => subscribe('chat:agent', callback as (payload: unknown) => void),
    onContext: () => () => {},
    onRagProgress: () => () => {},
  },
  files: {
    getPath: () => '',
  },
};
