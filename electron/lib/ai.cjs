const crypto = require('node:crypto');
const { createTwoFilesPatch } = require('diff');
const {
  UserError,
  fail,
  safeJsonParse,
  hashText,
  normalizeTitle,
  slugify,
  truncate,
  asStringArray,
  nowIso,
  isoDate,
} = require('./util.cjs');
const git = require('./git.cjs');

const TYPE_MAP = {
  concept: 'concept',
  概念: 'concept',
  entity: 'entity',
  实体: 'entity',
  source: 'source',
  来源: 'source',
  note: 'note',
  笔记: 'note',
};

const FOLDER_MAP = {
  concept: 'concepts',
  entity: 'entities',
  source: 'sources',
  note: 'notes',
};

const AGENT_PROFILE = {
  name: '知识助手',
  prompt:
    '你负责回答关于用户知识库、收件箱、条目关系和内容的问题，也能做多步检索、基于用户笔记起草或改写文字，并检查知识库结构给出整理建议。需要事实、数量、清单或笔记原文时，先调用工具，不要凭印象回答。区分事实、推断和资料缺口，不要编造笔记里没有的内容。',
};

function normalizeBase(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    throw new UserError('接口地址需要以 http:// 或 https:// 开头');
  }
  return base;
}

function chatEndpoint(baseUrl) {
  const base = normalizeBase(baseUrl);
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

function modelsEndpoint(baseUrl) {
  let base = normalizeBase(baseUrl);
  base = base.replace(/\/chat\/completions$/i, '');
  if (/\/models$/i.test(base)) return base;
  return `${base}/models`;
}

function isLocalBase(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(host);
  } catch {
    return false;
  }
}

function httpError(status, body) {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || parsed?.message || '';
  } catch {
    detail = '';
  }
  let message;
  if (status === 401 || status === 403) {
    message = '模型密钥无效或没有权限，请到设置里检查。';
  } else if (status === 404) {
    message = '接口地址或模型名称不对，请检查设置。';
  } else if (status === 429) {
    message = '模型服务繁忙或额度不足，请稍后再试。';
  } else if (status === 400) {
    message = detail
      ? `模型服务拒绝了这次请求：${truncate(detail, 160)}`
      : '模型服务拒绝了这次请求，请检查模型名称。';
  } else if (status >= 500) {
    message = detail
      ? `模型服务返回了 ${status}：${truncate(detail, 160)}`
      : `模型服务返回了 ${status}，请稍后再试。`;
  } else {
    message = `模型服务返回了 ${status}，请稍后再试。`;
  }
  const error = new UserError(message);
  error.statusCode = status;
  error.upstreamDetail = detail;
  return error;
}

class AiService {
  constructor(settings, vault, mcp = null, rag = null) {
    this.settings = settings;
    this.vault = vault;
    this.mcp = mcp;
    this.rag = rag;
    this.pending = new Map();
    this.localTools = [
      {
        name: 'list_inbox',
        label: '查看收件箱',
        description: '列出当前收件箱里所有待整理资料，包含标题、来源、日期和摘要。参数：{}',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_library',
        label: '查看知识库',
        description:
          '列出知识库条目。参数：{"type":"concept|entity|source|note"}，type 可省略。',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['concept', 'entity', 'source', 'note'] },
          },
        },
      },
      {
        name: 'search_notes',
        label: '搜索笔记',
        description: '按关键词搜索收件箱和知识库。参数：{"query":"关键词","limit":5}。',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
      {
        name: 'read_note',
        label: '读取笔记',
        description: '读取一条笔记的完整内容。参数：{"path":"笔记路径"}。',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ];
  }

  async searchNotes(query, limit = 6, options = {}) {
    if (this.rag) {
      try {
        const hits = await this.rag.search(query, limit, options);
        if (hits.length) return hits;
      } catch (error) {
        console.warn('[rag] search fallback:', error.message);
      }
    }
    return this.vault.search(query, limit, options);
  }

  config(overrides = {}) {
    const ai = this.settings.get().ai;
    const baseUrl = String(overrides.baseUrl ?? ai.baseUrl ?? '').trim();
    const model = String(overrides.model ?? ai.model ?? '').trim();
    const key =
      overrides.apiKey !== undefined && String(overrides.apiKey).trim()
        ? String(overrides.apiKey).trim()
        : this.settings.getKey();
    if (!baseUrl) throw new UserError('还没有填写模型接口地址');
    if (!model) throw new UserError('还没有填写模型名称');
    if (!key && !isLocalBase(baseUrl)) {
      throw new UserError('还没有连接模型服务，请先在设置里填写密钥。');
    }
    return { baseUrl, model, key, preset: overrides.preset ?? ai.preset };
  }

  async request(messages, options = {}) {
    const cfg = this.config(options.overrides);
    const timeoutMs = options.timeoutMs || 120000;
    const idleTimeoutMs = options.stream ? Number(options.idleTimeoutMs) || 60000 : 0;
    const idleController = new AbortController();
    let idleTimer = null;
    let idleTimedOut = false;
    const armIdle = () => {
      if (!idleTimeoutMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimedOut = true;
        idleController.abort();
      }, idleTimeoutMs);
    };
    const disarmIdle = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (idleTimeoutMs) signals.push(idleController.signal);
    if (options.signal) signals.push(options.signal);
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.key) headers.Authorization = `Bearer ${cfg.key}`;
    const startedAt = Date.now();
    if (options.stream) {
      const chars = messages.reduce((sum, message) => sum + String(message.content || '').length, 0);
      console.log(
        `[ai] stream start model=${cfg.model} messages=${messages.length} promptChars=${chars}`,
      );
    }

    let response;
    try {
      response = await fetch(chatEndpoint(cfg.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: cfg.model,
          messages,
          temperature: options.temperature ?? 0.4,
          stream: Boolean(options.stream),
        }),
        signal,
      });
    } catch (error) {
      disarmIdle();
      if (options.signal?.aborted) {
        throw new UserError('已取消这次请求。');
      }
      if (error?.name === 'TimeoutError') {
        const timeoutError = new UserError('模型响应超时，请稍后再试。');
        timeoutError.retryable = true;
        throw timeoutError;
      }
      if (error?.name === 'AbortError') {
        throw new UserError('已取消这次请求。');
      }
      const networkError = new UserError('连接不上模型服务，请检查网络和接口地址。');
      networkError.retryable = true;
      throw networkError;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(
        `[ai] ${options.stream ? 'stream' : 'json'} request failed`,
        response.status,
        truncate(body, 1500),
      );
      throw httpError(response.status, body);
    }

    const contentType = response.headers.get('content-type') || '';
    if (options.stream) {
      console.log(
        `[ai] stream response status=${response.status} type=${contentType || 'unknown'} in ${Date.now() - startedAt}ms`,
      );
    }
    if (options.stream && contentType.includes('application/json')) {
      const payload = await response.json().catch(() => null);
      let content = payload?.choices?.[0]?.message?.content;
      if (Array.isArray(content)) {
        content = content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
      }
      if (typeof content === 'string' && content.trim()) {
        console.log(`[ai] stream got JSON body chars=${content.length}`);
        options.onDelta?.(content);
        return content;
      }
      throw new UserError('模型没有返回内容，请重试一次。');
    }

    if (!options.stream) {
      const payload = await response.json().catch(() => null);
      const reasoning = payload?.choices?.[0]?.message?.reasoning_content;
      if (typeof reasoning === 'string' && reasoning) options.onThinking?.(reasoning);
      let content = payload?.choices?.[0]?.message?.content;
      if (Array.isArray(content)) {
        content = content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
      }
      if (typeof content !== 'string' || !content.trim()) {
        throw new UserError('模型没有返回内容，请重试一次。');
      }
      return content;
    }

    if (!response.body) throw new UserError('模型没有返回内容，请重试一次。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let firstChunkAt = 0;
    let thinkingChars = 0;
    try {
      armIdle();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!firstChunkAt) {
          firstChunkAt = Date.now();
          console.log(`[ai] stream first byte in ${firstChunkAt - startedAt}ms`);
        }
        armIdle();
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          line = line.replace(/\r$/, '').trim();
          if (!line || line.startsWith(':') || !line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          const choice = parsed?.choices?.[0];
          let reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
          if (Array.isArray(reasoning)) {
            reasoning = reasoning
              .map((part) => (typeof part === 'string' ? part : part?.text || ''))
              .join('');
          }
          if (typeof reasoning === 'string' && reasoning) {
            thinkingChars += reasoning.length;
            options.onThinking?.(reasoning);
          }
          let delta = choice?.delta?.content;
          if (Array.isArray(delta)) {
            delta = delta.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
          }
          if (typeof delta === 'string' && delta) {
            content += delta;
            options.onDelta?.(delta);
          }
        }
      }
    } catch (error) {
      if (idleTimedOut) {
        console.log(
          `[ai] stream idle ${Math.round(idleTimeoutMs / 1000)}s after ${content.length} chars`,
        );
        const idleError = new UserError(
          `模型有 ${Math.round(idleTimeoutMs / 1000)} 秒没有输出新内容，这次生成已经停下，请重试。`,
        );
        idleError.partial = content;
        idleError.idle = true;
        throw idleError;
      }
      if (options.signal?.aborted) {
        throw new UserError('已取消这次请求。');
      }
      if (error?.name === 'TimeoutError') {
        throw new UserError('模型响应超时，请稍后再试。');
      }
      if (error?.name === 'AbortError') {
        throw new UserError('已取消这次请求。');
      }
      throw new UserError('模型连接中断了，请重试一次。');
    } finally {
      disarmIdle();
      reader.releaseLock();
    }
    if (!content.trim()) throw new UserError('模型没有返回内容，请重试一次。');
    if (options.stream) {
      console.log(
        `[ai] stream done chars=${content.length} thinkingChars=${thinkingChars} in ${Date.now() - startedAt}ms firstByte=${firstChunkAt ? firstChunkAt - startedAt : 'none'}ms`,
      );
    }
    return content;
  }

  async testConnection(overrides = {}) {
    const cfg = this.config(overrides);
    const headers = {};
    if (cfg.key) headers.Authorization = `Bearer ${cfg.key}`;
    let response;
    try {
      response = await fetch(modelsEndpoint(cfg.baseUrl), {
        headers,
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError') throw new UserError('连接超时，请检查接口地址。');
      throw new UserError('连接不上这个接口，请检查网络和地址。');
    }
    if (response.status === 405) {
      const reply = await this.request(
        [{ role: 'user', content: '只回复：连接成功' }],
        { overrides, timeoutMs: 20000, temperature: 0 },
      );
      return { ok: true, message: reply.trim().slice(0, 40) || '连接成功' };
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw httpError(response.status, body);
    }
    let models = [];
    try {
      const payload = await response.json();
      const list = payload?.data || payload?.models || [];
      models = Array.isArray(list)
        ? list.map((item) => item?.id || item?.name).filter(Boolean).slice(0, 6)
        : [];
    } catch {
      models = [];
    }
    return { ok: true, message: '连接成功', models };
  }

  async buildOrganizePrompt(rawNote, extra, catalog, relevant) {
    const agents = await this.vault
      .readNote('AGENTS.md')
      .then((note) => note.body)
      .catch(() => '');
    const system = `你是「知屿」的知识整理助手。你的工作是把一份原始资料整理成可以长期复用的中文知识条目。

<整理规则>
${truncate(agents, 4000)}
</整理规则>

<已有条目>
${truncate(catalog, 6000)}
</已有条目>

<可能相关的已有条目全文>
${truncate(relevant, 5000)}
</可能相关的已有条目全文>

输出要求：
- 只输出一个合法的 JSON 对象，不要 Markdown 代码围栏，不要任何解释。
- JSON 结构如下：
{
  "summary": "用一句话概括这份资料",
  "pages": [
    {
      "type": "concept | entity | source",
      "title": "条目名称",
      "slug": "可选的短标识，英文或中文",
      "aliases": ["别名"],
      "tags": ["标签"],
      "body": "Markdown 正文，不含 frontmatter，也不要重复一级标题"
    }
  ],
  "log": "一句不超过 40 字的整理说明"
}
- 最多整理出 6 个条目。资料信息量有限时，宁可少写。
- 已有条目中语义相同的，必须沿用原有 type 和 title，并在原有内容基础上合并更新，不要重复创建。
- 概念条目写清楚“是什么、为什么重要、怎么用”；实体条目写清楚对象、能力与适用场景；来源条目总结资料要点与出处。
- 正文用简体中文，克制、具体，通常 300–800 字；使用 [[条目名]] 连接相关条目。
- 只写资料中出现过的事实。不确定的内容不写，不编造来源和数据。`;
    const user = `请整理下面这份资料。

标题：${rawNote.title}
来源：${rawNote.source || '未注明'}
日期：${rawNote.created || ''}

原始内容：
${truncate(rawNote.body, 16000)}

补充提示：${extra || '无'}`;
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  async completeOrganize(messages, onDelta, onThinking, options = {}) {
    try {
      return await this.request(messages, {
        temperature: 0.2,
        timeoutMs: 180000,
        idleTimeoutMs: options.idleTimeoutMs || 45000,
        stream: true,
        signal: options.signal,
        onDelta,
        onThinking,
      });
    } catch (error) {
      if (error?.partial) {
        try {
          safeJsonParse(error.partial);
          return error.partial;
        } catch {
          // partial output is not valid JSON yet
        }
      }
      const retryable =
        error?.retryable || (typeof error?.statusCode === 'number' && error.statusCode >= 500);
      if (!retryable) throw error;
      console.warn('[ai] streaming organize failed, retrying without stream:', error.message);
      return this.request(messages, {
        temperature: 0.2,
        timeoutMs: 180000,
        onThinking,
        signal: options.signal,
      });
    }
  }

  async organize(rawPaths = [], onProgress, options = {}) {
    if (!Array.isArray(rawPaths) || !rawPaths.length) {
      fail('请先选择要整理的资料');
    }
    const allNotes = await this.vault.listNotes();
    const wikiNotes = allNotes.filter((note) => note.type !== 'raw');
    const catalog = wikiNotes
      .slice(0, 120)
      .map((note) => {
        const aliases = note.aliases.length ? `（别名：${note.aliases.join('、')}）` : '';
        return `- [${note.type}] ${note.title}${aliases} — ${note.excerpt}`;
      })
      .join('\n');

    const proposals = [];
    for (let index = 0; index < rawPaths.length; index += 1) {
      if (options.signal?.aborted) throw new UserError('已取消这次整理。');
      const rawPath = rawPaths[index];
      const rawNote = await this.vault.readNote(rawPath);
      if (rawNote.type !== 'raw') {
        throw new UserError('只有收件箱里的资料可以整理');
      }
      if (rawNote.truncated) {
        throw new UserError('这份资料太大，暂时不能在应用内一次整理；请先拆分文件。');
      }
      onProgress?.({
        current: index + 1,
        total: rawPaths.length,
        title: rawNote.title,
      });
      const relevantHits = await this.searchNotes(
        `${rawNote.title} ${rawNote.body.slice(0, 1600)}`,
        5,
        { scope: 'wiki' },
      );
      console.log(
        `[ai] organize note="${rawNote.title}" bodyChars=${rawNote.body.length} relevant=${relevantHits.length}`,
      );
      const relevant = relevantHits
        .map((hit) => `### ${hit.title}（${hit.type}，已存在）\n${truncate(hit.body, 900)}`)
        .join('\n\n');
      const messages = await this.buildOrganizePrompt(rawNote, '', catalog, relevant);
      let output = await this.completeOrganize(messages, undefined, undefined, {
        signal: options.signal,
      });
      let parsed;
      try {
        parsed = safeJsonParse(output);
      } catch {
        messages.push({ role: 'assistant', content: output });
        messages.push({
          role: 'user',
          content: '上面的输出不是合法 JSON。请重新输出，只给一个合法 JSON 对象，不要代码围栏，不要解释。',
        });
        output = await this.completeOrganize(messages, undefined, undefined, {
          signal: options.signal,
        });
        try {
          parsed = safeJsonParse(output);
        } catch {
          throw new UserError('这次整理没有生成可用的内容，请再试一次。');
        }
      }

      const proposedPages = Array.isArray(parsed.pages) ? parsed.pages : [];
      if (!proposedPages.length) {
        throw new UserError('AI 没有从这份资料里提取到可写入的条目，可以补充资料后再试。');
      }

      const pages = [];
      const usedPaths = new Set();
      for (const proposal of proposedPages.slice(0, 6)) {
        const type = TYPE_MAP[String(proposal?.type || '').trim().toLowerCase()] || TYPE_MAP[proposal?.type];
        const title = String(proposal?.title || '').trim();
        const body = String(proposal?.body || '').trim();
        if (!type || !title || body.length < 8) continue;
        if (pages.some((page) => normalizeTitle(page.title) === normalizeTitle(title))) continue;

        const existing = wikiNotes.find(
          (note) =>
            normalizeTitle(note.title) === normalizeTitle(title) ||
            note.aliases.some((alias) => normalizeTitle(alias) === normalizeTitle(title)),
        );
        let pagePath;
        let action = 'create';
        let existingBody = '';
        let existingData = {};
        if (existing) {
          pagePath = existing.path;
          action = 'update';
          const existingNote = await this.vault.readNote(existing.path);
          existingBody = existingNote.body;
          existingData = existingNote.data;
        } else {
          const folder = FOLDER_MAP[type] || 'notes';
          pagePath = await this.vault.uniquePath(`wiki/${folder}`, slugify(proposal?.slug || title));
        }
        if (usedPaths.has(pagePath)) continue;
        usedPaths.add(pagePath);

        const diff =
          action === 'update'
            ? createTwoFilesPatch(pagePath, pagePath, existingBody, body, '现有内容', '整理后', {
                context: 3,
              })
            : '';
        pages.push({
          path: pagePath,
          type,
          title: title.slice(0, 120),
          action,
          body,
          diff: truncate(diff, 24000),
          existingBody,
          existingHash: hashText(existingBody),
          existingData,
          aliases: asStringArray(proposal?.aliases),
          tags: asStringArray(proposal?.tags),
          rawPath,
        });
      }

      if (!pages.length) {
        throw new UserError('AI 返回的条目内容不完整，请再试一次。');
      }
      proposals.push({
        rawPath,
        rawTitle: rawNote.title,
        summary: String(parsed.summary || '').trim(),
        log: String(parsed.log || '').trim(),
        pages,
      });
    }

    const id = crypto.randomUUID();
    this.pending.set(id, {
      createdAt: Date.now(),
      vaultRoot: this.vault.root,
      proposals,
    });
    this.cleanupPending();
    return this.previewOf(id);
  }

  cleanupPending() {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, item] of this.pending) {
      if (item.createdAt < cutoff) this.pending.delete(id);
    }
  }

  previewOf(id) {
    const pending = this.pending.get(id);
    if (!pending) throw new UserError('这次整理已经过期，请重新发起。');
    const pages = pending.proposals.flatMap((proposal) => proposal.pages);
    return {
      id,
      proposals: pending.proposals.map((proposal) => ({
        rawPath: proposal.rawPath,
        rawTitle: proposal.rawTitle,
        summary: proposal.summary,
        log: proposal.log,
        pages: proposal.pages.map((page) => ({
          path: page.path,
          type: page.type,
          title: page.title,
          action: page.action,
          body: page.body,
          diff: page.diff,
          aliases: page.aliases,
          tags: page.tags,
        })),
      })),
      stats: {
        pages: pages.length,
        creates: pages.filter((page) => page.action === 'create').length,
        updates: pages.filter((page) => page.action === 'update').length,
      },
    };
  }

  async applyOrganize(id) {
    const pending = this.pending.get(id);
    if (!pending) throw new UserError('这次整理已经过期，请重新发起。');
    if (pending.vaultRoot !== this.vault.root) {
      throw new UserError('知识库已经切换，请重新发起整理。');
    }
    const allPages = pending.proposals.flatMap((proposal) => proposal.pages);
    for (const page of allPages) {
      const current = await this.vault.readNote(page.path).catch(() => null);
      if (page.action === 'update') {
        if (!current) throw new UserError(`《${page.title}》在预览后被删除了，请重新整理。`);
        if (hashText(current.body) !== page.existingHash) {
          throw new UserError(`《${page.title}》在预览后发生了变化，请重新整理。`);
        }
      } else if (current) {
        throw new UserError(`《${page.title}》已经存在，请重新整理以合并内容。`);
      }
    }

    const written = [];
    for (const proposal of pending.proposals) {
      const wikiPaths = [];
      for (const page of proposal.pages) {
        const current = await this.vault.readNote(page.path).catch(() => null);
        const data = { ...(current?.data || {}) };
        const stamp = nowIso();
        data.title = page.title;
        data.type = page.type;
        data.created = data.created || stamp;
        data.updated = stamp;
        data.tags = [...new Set([...asStringArray(data.tags), ...page.tags])];
        data.aliases = [...new Set([...asStringArray(data.aliases), ...page.aliases])];
        data.sources = [...new Set([...asStringArray(data.sources), proposal.rawPath])];
        delete data.status;
        const abs = await this.vault.resolveForWrite(page.path);
        await this.vault.writeMarkdown(abs, data, page.body);
        this.vault.cache.delete(abs);
        written.push(page.path);
        wikiPaths.push(page.path);
      }
      await this.vault.updateRawStatus(proposal.rawPath, {
        status: 'processed',
        wikiPaths,
      });
      await this.vault.appendLog(
        proposal.log || `整理《${proposal.rawTitle}》· 更新 ${proposal.pages.length} 个条目`,
      );
    }
    await this.vault.rebuildIndex();
    this.pending.delete(id);

    let gitCommitted = false;
    let snapshotFile = '';
    let warning = '';
    if (this.settings.get().gitAutoSnapshot) {
      try {
        const hash = await git.commit(
          this.vault.root,
          `整理：${pending.proposals.map((proposal) => proposal.rawTitle).join('、')}`,
        );
        gitCommitted = Boolean(hash);
        const snapshotDir = this.settings.get().snapshotDir;
        if (gitCommitted && snapshotDir) {
          snapshotFile = (await git.bundle(this.vault.root, snapshotDir)) || '';
        }
      } catch (error) {
        warning = '知识已经写入，但版本快照没有成功。';
      }
    }
    return { written, gitCommitted, snapshotFile, warning };
  }

  async summarizeContext(existingSummary, messages) {
    const transcript = (Array.isArray(messages) ? messages : [])
      .map((message) => {
        const role = message.role === 'assistant' ? '助手' : '用户';
        return `${role}：${truncate(String(message.content || ''), 3000)}`;
      })
      .join('\n\n');
    const system = `你是对话上下文压缩器。请把一段对话压缩成后续对话可继续使用的摘要。

要求：
- 保留：用户目标与偏好、已确认的事实和结论、重要来源、未解决的问题、下一步。
- 合并已有摘要，不要重复。
- 不编造、不推测，不写逐句过程。
- 用简体中文条目式表达，控制在 800 字以内。`;
    const user = `已有摘要（可能为空）：
${existingSummary || '（无）'}

需要压缩的对话：
${truncate(transcript, 60000)}`;
    const content = await this.request(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { stream: true, temperature: 0.2, timeoutMs: 120000 },
    );
    return truncate(content, 2000);
  }

  async chat(messages, onDelta, signal, options = {}) {
    const cleaned = (Array.isArray(messages) ? messages : [])
      .filter((message) => ['user', 'assistant'].includes(message?.role))
      .map((message) => ({
        role: message.role,
        content: String(message.content || ''),
      }));
    if (!cleaned.length) throw new UserError('请先输入一个问题。');
    const chatOptions = { ...options };
    if (options.notePath) {
      const focusNote = await this.vault.readNote(String(options.notePath)).catch(() => null);
      if (focusNote) {
        chatOptions.focusSource = this.sourceOfNote(focusNote);
        chatOptions.focusBlock = `\n\n用户当前明确选中了这篇资料，回答时优先依据它：
### 《${focusNote.title}》（${focusNote.type === 'raw' ? '收件箱原文' : '知识条目'} · ${focusNote.path}）
<当前资料>
${truncate(focusNote.body, 24000)}
</当前资料>${focusNote.truncated ? '\n（这是大文件的前置预览，可能不是全文。）' : ''}
如果用户的问题只涉及这篇资料，直接依据它回答，不需要再调用检索工具。`;
      } else {
        chatOptions.focusBlock = '\n\n用户选择了一篇资料，但它已经不存在。';
      }
    }
    if (options.agentId && options.agentId !== 'chat') {
      return this.agentChat(cleaned, onDelta, signal, chatOptions);
    }
    return this.ragChat(cleaned, onDelta, signal, chatOptions);
  }

  async ragChat(cleaned, onDelta, signal, options = {}) {
    const lastUser = [...cleaned].reverse().find((message) => message.role === 'user');
    if (!lastUser) throw new UserError('请先输入一个问题。');
    const hits = await this.searchNotes(lastUser.content, 6);
    const context = hits.length
      ? hits
          .map(
            (hit) =>
              `### ${hit.title}（${hit.type === 'raw' ? '资料' : '知识条目'} · ${hit.path}）\n${truncate(
                hit.body,
                1800,
              )}`,
          )
          .join('\n\n')
      : '（知识库里没有找到相关条目）';
    const summaryBlock = options.contextSummary
      ? `\n\n此前对话的压缩摘要：\n${truncate(options.contextSummary, 4000)}`
      : '';

    const system = `你是「知屿」的知识助手。你要优先依据知识库里的内容回答问题。

要求：
- 用简体中文，直接、具体，不说套话。
- 引用知识库内容时，在相关句子后面用 [[条目标题]] 标注来源。
- 如果知识库里的内容不足以回答，直接说“知识库里还没有足够的内容”，然后给出可以补充什么方向；不要编造事实或来源。
- 不要提及“片段”“上下文”“检索”这类实现细节。
- 回答控制在 300 字以内，除非用户要求展开。
${summaryBlock}
${options.focusBlock || ''}

下面是知识库里与问题相关的内容：

<知识库>
${context}
</知识库>`;

    const content = await this.request(
      [{ role: 'system', content: system }, ...cleaned],
      {
        stream: true,
        onDelta,
        temperature: 0.5,
        timeoutMs: 120000,
        signal,
        overrides: options.model ? { model: options.model } : undefined,
      },
    );
    const sources = [];
    const seen = new Set();
    if (options.focusSource?.path) {
      sources.push(options.focusSource);
      seen.add(options.focusSource.path);
    }
    for (const hit of hits) {
      if (seen.has(hit.path)) continue;
      seen.add(hit.path);
      sources.push({
        path: hit.path,
        title: hit.title,
        type: hit.type,
        status: hit.status,
      });
    }
    return { content, sources };
  }

  sourceOfNote(note) {
    return {
      path: note.path,
      title: note.title,
      type: note.type,
      status: note.status || '',
    };
  }

  async buildVaultManifest() {
    const notes = await this.vault.listNotes();
    const pending = notes.filter((note) => note.type === 'raw' && note.status !== 'processed');
    const wiki = notes.filter((note) => note.type !== 'raw');
    const lines = [
      `当前收件箱：${pending.length} 条待整理`,
      ...pending.slice(0, 30).map((note, index) => {
        const source = note.source ? ` · 来源 ${note.source}` : '';
        return `${index + 1}. 《${note.title}》${source} — ${note.excerpt}`;
      }),
      '',
      `知识库：${wiki.length} 个条目`,
      ...wiki.slice(0, 50).map((note) => `- [${note.typeLabel}] ${note.title} — ${note.excerpt}`),
    ];
    return truncate(lines.join('\n'), 6000);
  }

  async runLocalTool(name, args = {}) {
    if (name === 'list_inbox') {
      const notes = await this.vault.listNotes();
      const pending = notes.filter((note) => note.type === 'raw' && note.status !== 'processed');
      const text = pending.length
        ? `当前收件箱有 ${pending.length} 条待整理资料：\n\n${pending
            .map(
              (note, index) =>
                `${index + 1}. 《${note.title}》\n来源：${note.source || '未注明'}\n创建：${
                  note.created || ''
                }\n摘要：${note.excerpt}\n路径：${note.path}`,
            )
            .join('\n\n')}`
        : '当前收件箱是空的。';
      return { text, sources: pending.map((note) => this.sourceOfNote(note)) };
    }
    if (name === 'list_library') {
      const type = String(args?.type || '').trim();
      const notes = await this.vault.listNotes();
      const selected = notes.filter(
        (note) => note.type !== 'raw' && (!type || note.type === type),
      );
      const text = selected.length
        ? `知识库有 ${selected.length} 个条目：\n\n${selected
            .map((note) => `- [${note.typeLabel}] 《${note.title}》 — ${note.excerpt}`)
            .join('\n')}`
        : '知识库里还没有条目。';
      return { text, sources: selected.map((note) => this.sourceOfNote(note)) };
    }
    if (name === 'search_notes') {
      const query = String(args?.query || '').trim();
      if (!query) fail('搜索工具需要提供 query 参数');
      const limit = Math.max(1, Math.min(10, Number(args?.limit) || 5));
      const hits = await this.searchNotes(query, limit);
      const text = hits.length
        ? `搜索「${query}」找到：\n\n${hits
            .map(
              (hit) =>
                `### ${hit.title}（${hit.type} · ${hit.path}）\n${truncate(hit.body, 1200)}`,
            )
            .join('\n\n')}`
        : `没有找到与「${query}」相关的笔记。`;
      return { text, sources: hits.map((hit) => this.sourceOfNote(hit)) };
    }
    if (name === 'read_note') {
      const notePath = String(args?.path || '').trim();
      if (!notePath) fail('读取工具需要提供 path 参数');
      const note = await this.vault.readNote(notePath);
      const text = `《${note.title}》（${note.typeLabel} · ${note.path}）\n${truncate(
        note.body,
        6000,
      )}`;
      return { text, sources: [this.sourceOfNote(note)] };
    }
    throw new UserError(`未知工具：${name}`);
  }

  toolLabel(name) {
    const local = this.localTools.find((tool) => tool.name === name);
    if (local) return local.label;
    if (name.startsWith('mcp__')) {
      const tool = this.mcp?.getToolDefs().find((item) => item.fullName === name);
      return tool ? `${tool.serverName} · ${tool.name}` : '调用 MCP 工具';
    }
    return `调用工具 ${name}`;
  }

  async resolveCitationSources(content, existing = []) {
    const sources = [...existing];
    const seen = new Set(sources.map((source) => source.path));
    const notes = await this.vault.listNotes();
    const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = re.exec(String(content || '')))) {
      const target = match[1].replace(/\.md$/i, '').trim().toLowerCase();
      const note = notes.find((item) => {
        const candidates = [
          item.title,
          ...item.aliases,
          item.path.replace(/\.md$/i, ''),
          item.path.split('/').pop()?.replace(/\.md$/i, '') || '',
        ];
        return candidates.some((value) => value.trim().toLowerCase() === target);
      });
      if (note && !seen.has(note.path)) {
        seen.add(note.path);
        sources.push(this.sourceOfNote(note));
      }
    }
    return sources;
  }

  async agentChat(cleaned, onDelta, signal, options = {}) {
    const profile = AGENT_PROFILE;
    const manifest = await this.buildVaultManifest();
    let mcpTools = [];
    if (this.mcp) {
      try {
        await this.mcp.ensure();
        mcpTools = this.mcp.getToolDefs();
      } catch (error) {
        console.warn('[agent] MCP unavailable:', error.message);
      }
    }
    const localLines = this.localTools
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join('\n');
    const mcpLines = mcpTools
      .slice(0, 30)
      .map(
        (tool) =>
          `- ${tool.fullName}: ${tool.description || tool.name}. 参数 schema: ${truncate(
            JSON.stringify(tool.inputSchema || {}),
            600,
          )}`,
      )
      .join('\n');
    const summaryBlock = options.contextSummary
      ? `\n此前对话的压缩摘要：\n${truncate(options.contextSummary, 4000)}`
      : '';

    const plannerSystem = `你是「知屿」的${profile.name}。${profile.prompt}

当前知识库概况：
${manifest}
${summaryBlock}
${options.focusBlock || ''}

可用本地工具：
${localLines}

${mcpLines ? `可用 MCP 工具：\n${mcpLines}\n` : ''}
工作方式：
- 需要知识库事实、清单、数量或笔记原文时，先调用工具，不要凭印象回答。
- 每次只输出一个合法 JSON 对象，不要 Markdown 代码围栏：
  调用工具：{"action":"tool","tool":"工具名","args":{...},"thought":"一句理由"}
  信息足够：{"action":"final","content":"最终回答"}
- 最多调用 4 次工具。不要编造工具结果。
- 最终回答用简体中文；引用来源用 [[标题]]。`;

    const plannerMessages = [{ role: 'system', content: plannerSystem }, ...cleaned];
    const onThinking = (delta) => {
      if (typeof delta === 'string' && delta) {
        options.onAgent?.({ type: 'thinking-delta', delta });
      }
    };
    const collectedSources = [];
    const seenSources = new Set();
    const addSources = (sources = []) => {
      for (const source of sources) {
        if (!source?.path || seenSources.has(source.path)) continue;
        seenSources.add(source.path);
        collectedSources.push(source);
      }
    };
    if (options.focusSource?.path) addSources([options.focusSource]);
    let toolResults = '';

    for (let step = 0; step < 4; step += 1) {
      let raw;
      try {
        raw = await this.completeOrganize(plannerMessages, undefined, onThinking);
      } catch (error) {
        console.warn('[agent] planner failed:', error.message);
        break;
      }
      let action = null;
      try {
        action = safeJsonParse(raw);
      } catch {
        // Let the final answer pass use the knowledge-base manifest instead of raw prose.
        break;
      }
      if (action?.thought) {
        options.onAgent?.({
          type: 'thinking',
          id: `thought-${step}-${crypto.randomUUID()}`,
          content: String(action.thought),
        });
      }
      if (!action || action.action === 'final' || !action.tool) {
        break;
      }
      const toolName = String(action.tool || '').trim();
      const args = action.args && typeof action.args === 'object' ? action.args : {};
      const stepId = crypto.randomUUID();
      options.onTool?.({ label: this.toolLabel(toolName), status: 'running' });
      options.onAgent?.({
        type: 'tool',
        id: stepId,
        tool: toolName,
        label: this.toolLabel(toolName),
        status: 'running',
        args,
      });
      let result;
      try {
        if (toolName.startsWith('mcp__')) {
          if (!this.mcp) throw new Error('MCP 服务未配置');
          result = await this.mcp.callTool(toolName, args);
          result.sources = [];
        } else {
          result = await this.runLocalTool(toolName, args);
        }
      } catch (error) {
        result = { text: `工具调用失败：${error.message}`, sources: [], isError: true };
      }
      options.onTool?.({ label: this.toolLabel(toolName), status: 'done' });
      options.onAgent?.({
        type: 'tool',
        id: stepId,
        tool: toolName,
        label: this.toolLabel(toolName),
        status: result.isError ? 'error' : 'done',
        detail: truncate(result.text, 500),
      });
      addSources(result.sources || []);
      const toolText = truncate(result.text, 8000);
      toolResults += `\n工具 ${toolName} 返回：\n${toolText}\n`;
      plannerMessages.push({ role: 'assistant', content: raw });
      plannerMessages.push({
        role: 'user',
        content: `工具 ${toolName} 返回：\n${toolText}`,
      });
    }

    const finalSystem = `你是「知屿」的${profile.name}。${profile.prompt}

当前知识库概况：
${manifest}
${summaryBlock}
${options.focusBlock || ''}

${toolResults ? `本轮工具结果：\n${toolResults}` : ''}

请只输出最终回答，不要输出工具调用 JSON。用简体中文，直接、具体。引用来源时使用 [[标题]]。
如果上面已经列出了收件箱或知识库清单，请直接整理并回答，不要说“没有清单”。不要编造没有出现的事实或来源。`;

    const finalMessages = [{ role: 'system', content: finalSystem }, ...cleaned];
    if (toolResults) {
      finalMessages.push({
        role: 'user',
        content: `请基于上面的工具结果回答我最后一个问题。`,
      });
    }
    const content = await this.request(finalMessages, {
      stream: true,
      onDelta,
      onThinking,
      temperature: 0.5,
      timeoutMs: 120000,
      signal,
      overrides: options.model ? { model: options.model } : undefined,
    });
    const sources = await this.resolveCitationSources(content, collectedSources);
    return { content, sources };
  }
}

module.exports = { AiService, chatEndpoint, modelsEndpoint };
