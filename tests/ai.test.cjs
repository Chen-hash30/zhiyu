const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../electron/lib/vault.cjs');
const { AiService } = require('../electron/lib/ai.cjs');

function startMockModel() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        payload = {};
      }
      requests.push({ url: req.url, body: payload });
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
        return;
      }
      const system = payload.messages?.[0]?.content || '';
      const isOrganize = system.includes('知识整理助手');
      const organizeContent = JSON.stringify({
        summary: '测试资料摘要',
        pages: [
          {
            type: 'concept',
            title: '测试概念',
            slug: 'test-concept',
            aliases: ['Test Concept'],
            tags: ['测试'],
            body: '测试概念是一个用于验证整理流程的条目。\n\n它和 [[第二大脑]] 有关。',
          },
        ],
        log: '整理测试资料',
      });
      if (payload.stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const content = isOrganize
          ? organizeContent
          : '根据知识库，测试概念是一个用于验证整理流程的条目。 参见 [[测试概念]]。';
        const chunks = [];
        for (let index = 0; index < content.length; index += 24) {
          chunks.push(content.slice(index, index + 24));
        }
        let chunkIndex = 0;
        const timer = setInterval(() => {
          if (chunkIndex >= chunks.length) {
            clearInterval(timer);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: chunks[chunkIndex] } }] })}\n\n`,
          );
          chunkIndex += 1;
        }, 5);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: organizeContent } }] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, requests });
    });
  });
}

test('AI 整理、写入、索引与对话引用', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zhiyu-ai-'));
  const mock = await startMockModel();
  try {
    const vault = new Vault(root);
    await vault.init({ seed: true });
    const raw = await vault.importText({
      title: 'AI 测试资料',
      content: '测试概念很重要，值得记录下来。',
      source: 'local',
    });
    const settings = {
      get: () => ({
        ai: {
          baseUrl: `http://127.0.0.1:${mock.port}/v1`,
          model: 'test-model',
          preset: 'custom',
        },
        gitAutoSnapshot: false,
      }),
      getKey: () => 'test-key',
    };
    const ai = new AiService(settings, vault);

    const connection = await ai.testConnection({
      baseUrl: `http://127.0.0.1:${mock.port}/v1`,
      model: 'test-model',
      apiKey: 'test-key',
    });
    assert.equal(connection.ok, true);

    const preview = await ai.organize([raw.path]);
    assert.equal(preview.stats.pages, 1);
    assert.equal(preview.stats.creates, 1);
    assert.equal(preview.proposals[0].pages[0].title, '测试概念');

    const applied = await ai.applyOrganize(preview.id);
    assert.ok(applied.written.includes('wiki/concepts/test-concept.md'));

    const note = await vault.readNote('wiki/concepts/test-concept.md');
    assert.ok(note.body.includes('测试概念'));
    assert.equal(note.type, 'concept');
    assert.ok(note.data.sources.includes(raw.path));

    const processedRaw = await vault.readNote(raw.path);
    assert.equal(processedRaw.status, 'processed');

    const index = await vault.readNote('index.md');
    assert.ok(index.body.includes('测试概念'));
    const log = await vault.readNote('log.md');
    assert.ok(log.body.includes('整理测试资料'));

    const deltas = [];
    const chat = await ai.chat(
      [{ role: 'user', content: '测试概念是什么？' }],
      (delta) => deltas.push(delta),
    );
    assert.ok(chat.content.includes('测试概念'));
    assert.ok(deltas.length > 1);
    assert.ok(chat.sources.some((source) => source.title === '测试概念'));

    const summary = await ai.summarizeContext('', [
      { role: 'user', content: '测试概念是什么？' },
      { role: 'assistant', content: '测试概念用于验证整理流程。' },
    ]);
    assert.ok(summary.length > 0);

    await ai.chat(
      [{ role: 'user', content: '用思考模型回答：测试概念是什么？' }],
      () => {},
      undefined,
      { agentId: 'chat', model: 'thinking-model' },
    );
    assert.ok(mock.requests.some((request) => request.body.model === 'thinking-model'));

    const focused = await ai.chat(
      [{ role: 'user', content: '这篇资料讲了什么？' }],
      () => {},
      undefined,
      { notePath: raw.path },
    );
    const focusRequest = mock.requests
      .filter((request) => request.url.endsWith('/chat/completions'))
      .at(-1);
    const focusSystem = focusRequest.body.messages[0].content;
    assert.ok(focusSystem.includes('用户当前明确选中了这篇资料'));
    assert.ok(focusSystem.includes('测试概念很重要'));
    assert.ok(focused.sources.some((source) => source.path === raw.path));

    assert.ok(mock.requests.some((request) => request.url.endsWith('/chat/completions')));
    assert.ok(mock.requests.some((request) => request.url.endsWith('/models')));
  } finally {
    await new Promise((resolve) => mock.server.close(resolve));
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('流式输出停住时接受已完整的 JSON 并结束', async () => {
  const fullJson = JSON.stringify({
    summary: '停流测试',
    pages: [{ type: 'concept', title: '停流概念', body: '一段足够长的概念正文内容。' }],
    log: '停流测试',
  });
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: fullJson } }] })}\n\n`);
      // 不发送 [DONE]，也不关闭连接，模拟上游输出完就停住
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const settings = {
    get: () => ({
      ai: {
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        model: 'test-model',
        preset: 'custom',
      },
    }),
    getKey: () => 'test-key',
  };
  const ai = new AiService(settings, null);
  const started = Date.now();
  try {
    const output = await ai.completeOrganize(
      [{ role: 'user', content: '请整理' }],
      () => {},
      undefined,
      { idleTimeoutMs: 250 },
    );
    const parsed = JSON.parse(output);
    assert.equal(parsed.summary, '停流测试');
    assert.ok(Date.now() - started < 5000);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('取消整理会中断流式请求', async () => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      let index = 0;
      const timer = setInterval(() => {
        index += 1;
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: `片段${index}` } }] })}\n\n`,
        );
      }, 20);
      res.on('close', () => clearInterval(timer));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const settings = {
    get: () => ({
      ai: {
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        model: 'test-model',
        preset: 'custom',
      },
    }),
    getKey: () => 'test-key',
  };
  const ai = new AiService(settings, null);
  const controller = new AbortController();
  try {
    await assert.rejects(
      ai.completeOrganize(
        [{ role: 'user', content: '请整理' }],
        () => controller.abort(),
        undefined,
        { signal: controller.signal, idleTimeoutMs: 5000 },
      ),
      /取消/,
    );
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
