const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Vault } = require('../electron/lib/vault.cjs');
const git = require('../electron/lib/git.cjs');

(async () => {
  const root = path.join(os.tmpdir(), 'zhiyu-debug-vault');
  const profile = path.join(os.tmpdir(), 'zhiyu-debug-profile');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(profile, { recursive: true });

  const vault = new Vault(root);
  await vault.init({ seed: false });

  const concept1 = await vault.createNote({
    type: 'concept',
    title: '第二大脑',
    tags: ['知识管理', '方法论'],
    body: `把记忆和思考交给一个可检索、可连接的外部系统，让人把注意力留给判断和创造。

## 核心循环

1. 捕获：只记录会改变行动或判断的信息。
2. 组织：让笔记彼此连接，而不是堆进文件夹。
3. 提炼：用自己的话压缩，留下可复用的观点。
4. 表达：输出会反过来检验理解。

真正的门槛不在输入，而在整理和重写。[[渐进式总结]] 提供了压缩方法，[[知识复利]] 解释了为什么值得长期做。工具上可以从 [[Obsidian]] 开始。`,
  });

  const concept2 = await vault.createNote({
    type: 'concept',
    title: '渐进式总结',
    tags: ['知识管理', '写作'],
    body: `渐进式总结是一种分层压缩笔记的方法：先保留原文，再逐层加粗、提炼、改写，直到留下真正可复用的结论。

## 四层结构

- 第一层：完整摘录，保留上下文。
- 第二层：加粗关键句，方便扫读。
- 第三层：在页首写三行摘要。
- 第四层：用自己的话重写成一条可引用的观点。

[[第二大脑]] 解决“放在哪里”，渐进式总结解决“留下什么”。延伸阅读：[[打造第二大脑]]。`,
  });

  const concept3 = await vault.createNote({
    type: 'concept',
    title: '知识复利',
    tags: ['知识管理', '决策'],
    body: `知识复利指的是：当笔记之间建立连接后，新资料会不断激活旧笔记，理解的增长快于输入的速度。

## 复利从哪里来

- 连接：一条新笔记和三条旧笔记相连，等于同时更新了四个理解节点。
- 重用：写作、决策、汇报时反复调用同一批观点，边际成本越来越低。
- 校正：旧结论被新证据修正，错误不会一直潜伏。

如果知识库半年后还能帮你做出更好的判断，它就在产生复利；如果只是不断变大，那可能只是库存。这与 [[第二大脑]] 的“表达”环节直接相关。`,
  });

  const concept4 = await vault.createNote({
    type: 'concept',
    title: '智能体记忆',
    tags: ['Agent', '记忆', '架构'],
    body: `智能体记忆是让 AI Agent 在多轮任务之间保留、检索并更新信息的机制。

## 三类记忆

- 工作记忆：当前任务的上下文，随会话结束而消失。
- 情景记忆：过去做过什么、结果如何，通常以事件或日志保存。
- 语义记忆：稳定的事实、偏好和领域知识，常落在文件或知识库里。

[[检索增强生成]] 解决“怎么找回来”，[[OpenClaw]] 这类本地 Agent 则提供读写文件与调用工具的运行环境。记忆需要版本管理和人工复核，否则过期信息会污染后续判断。`,
  });

  const concept5 = await vault.createNote({
    type: 'concept',
    title: '检索增强生成',
    tags: ['AI', '检索', '架构'],
    body: `检索增强生成（RAG）是在模型回答之前，先从外部知识库找出相关片段，再把片段放进上下文。

## 基本流程

1. 文档切分成可检索的小块。
2. 为每个块建立索引，常见做法是向量检索，也可以混合关键词检索。
3. 用户提问时召回最相关的若干块。
4. 模型基于这些块组织答案，并标注来源。

对个人知识库来说，RAG 的价值不在“更聪明”，而在让回答落在自己真正读过的材料上。它和 [[智能体记忆]] 一起构成长期协作的基础。`,
  });

  await vault.createNote({
    type: 'entity',
    title: 'Obsidian',
    tags: ['工具', 'Markdown'],
    body: `Obsidian 是一款以本地 Markdown 文件为核心的笔记工具，强调双向链接和插件扩展。

## 关键能力

- 双向链接：用 [[笔记名]] 自动形成反向索引。
- 关系图谱：把链接可视化，发现知识簇和孤岛。
- 插件生态：覆盖日历、看板、白板和 AI 等场景。
- 本地优先：笔记就是普通文件，不依赖云端账号。

在 [[第二大脑]] 的实践里，Obsidian 负责“存放和连接”，[[渐进式总结]] 负责“压缩”。`,
  });

  await vault.createNote({
    type: 'entity',
    title: 'OpenClaw',
    tags: ['AI', 'Agent', '开源'],
    body: `OpenClaw 是一个开源的本地 AI Agent 平台，强调在本机运行、接入多种模型，并让 Agent 直接操作文件与工具。

## 能做什么

- 读取和写入本地 Markdown 文件。
- 按计划执行任务，例如整理资料、生成摘要、维护索引。
- 通过技能扩展外部工具和消息渠道。

在知识库里，它可以承担 [[智能体记忆]] 里的执行层：读资料、写条目、维护链接。是否值得引入，取决于你能否为它定下清晰的规则边界。`,
  });

  await vault.createNote({
    type: 'source',
    title: '打造第二大脑',
    tags: ['书籍', '知识管理'],
    body: `《打造第二大脑》把个人知识管理拆成捕获、组织、提炼、表达四个环节，强调“为了使用而记录”。

## 三个可带走的观点

1. 笔记的价值在于未来能否被再次调用，而不是记录时的完整程度。
2. 组织方式应该服务于项目，而不是追求一套完美的分类。
3. 表达是知识管理的最后一公里，没有输出就没有真正的理解。

[[第二大脑]] 这条概念把它和 [[渐进式总结]] 连了起来。`,
  });

  await vault.importText({
    title: '为什么写作是思考',
    source: 'https://sspai.com/post/writing-is-thinking',
    content: `写作不是把想清楚的东西记录下来，而是通过写，逼自己把模糊的直觉变成可检验的句子。

## 摘录

> 如果你不能把一个想法写成三段话，很可能你还没有真正理解它。

- 写作会暴露论证里的跳跃。口头表达可以靠语气和表情糊弄过去，文字不行。
- 每写一次，都是一次重新组织。旧笔记不是仓库，而是可以反复加工的素材。
- 公开写作会带来外部反馈，但即使不公开，写给未来的自己也有价值。

这和 [[渐进式总结]] 的“用自己的话重写”是同一件事。下一步可以把 [[第二大脑]] 里“表达”这一节展开。`,
  });

  await vault.importText({
    title: 'Agent 记忆机制摘录',
    source: 'https://www.anthropic.com/engineering/agent-memory',
    content: `来自一篇关于 Agent 工程的访谈，重点在“记忆应该如何分层”。

- 上下文窗口不是记忆，只是工作台。把所有历史都塞进去，成本和噪声都会失控。
- 长期记忆需要写回机制：任务结束后，把结论写进文件。
- 检索应该发生在任务开始前，而不是每轮对话都全量搜索。
- 记忆需要过期和冲突处理，否则错误会一直复利。

这解释了为什么 [[智能体记忆]] 要区分工作记忆、情景记忆和语义记忆，也让我重新看待 [[检索增强生成]]。`,
  });

  const processedRaw = await vault.importText({
    title: '知识管理的复利效应',
    source: 'https://example.com/knowledge-compounding',
    content: `知识的价值不是线性叠加，而是网络效应。当一条新笔记能和三条旧笔记建立联系时，你得到的不只是第四条笔记，而是四个更新过的理解节点。

这直接支撑了 [[知识复利]] 的判断标准：知识库是否在帮你做出更好的判断。也提醒我，整理时不要只追求条目数量。`,
  });

  await vault.updateRawStatus(processedRaw.path, {
    status: 'processed',
    wikiPaths: [concept3.path, concept1.path],
  });
  await vault.rebuildIndex();
  await vault.appendLog('初始化演示知识库 · 8 个条目');

  await git.init(root);
  await git.commit(root, '初始化演示知识库');

  const settings = {
    theme: 'light',
    vaultPath: root,
    recentVaults: [root],
    windowBounds: { x: 60, y: 40, width: 1360, height: 740 },
    gitAutoSnapshot: true,
    ai: {
      preset: 'custom',
      baseUrl: 'http://127.0.0.1:8788/v1',
      model: 'test-model',
      keyEnc: `raw:${Buffer.from('test-key', 'utf8').toString('base64')}`,
    },
  };
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings, null, 2));
  console.log(JSON.stringify({ root, profile, concept1: concept1.path }, null, 2));
})();
