const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../electron/lib/vault.cjs');
const { AiService } = require('../electron/lib/ai.cjs');

function startAgentModel() {
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
      requests.push(payload);
      const system = payload.messages?.[0]?.content || '';
      let content;
      if (system.includes('可用本地工具')) {
        content = JSON.stringify({
          action: 'tool',
          tool: 'list_inbox',
          args: {},
          thought: '先查看收件箱',
        });
      } else {
        content =
          '收件箱里有两条待整理资料：《欢迎来到知屿》和《另一条资料》。你可以分别点开整理。';
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const chunks = [];
      for (let index = 0; index < content.length; index += 20) {
        chunks.push(content.slice(index, index + 20));
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
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, requests });
    });
  });
}

test('Agent 调用本地工具并回答收件箱清单', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zhiyu-agent-'));
  const mock = await startAgentModel();
  try {
    const vault = new Vault(root);
    await vault.init({ seed: true });
    await vault.importText({
      title: '另一条资料',
      content: '这是一条待整理资料。',
      source: 'local',
    });
    const ai = new AiService(
      {
        get: () => ({
          ai: {
            baseUrl: `http://127.0.0.1:${mock.port}/v1`,
            model: 'test-model',
            preset: 'custom',
          },
          gitAutoSnapshot: false,
          mcpServers: [],
        }),
        getKey: () => 'test-key',
      },
      vault,
    );
    const toolEvents = [];
    const answer = await ai.chat(
      [{ role: 'user', content: '我的收件箱里有哪些资料？' }],
      () => {},
      undefined,
      {
        agentId: 'knowledge',
        onTool: (event) => toolEvents.push(event),
      },
    );
    assert.ok(answer.content.includes('收件箱'));
    assert.ok(answer.sources.some((source) => source.title === '欢迎来到知屿'));
    assert.ok(answer.sources.some((source) => source.title === '另一条资料'));
    assert.ok(toolEvents.some((event) => event.label === '查看收件箱'));
    assert.ok(mock.requests.length >= 2);
    assert.ok(
      mock.requests.some((request) =>
        String(request.messages?.[0]?.content || '').includes('可用本地工具'),
      ),
    );
  } finally {
    await new Promise((resolve) => mock.server.close(resolve));
    await fsp.rm(root, { recursive: true, force: true });
  }
});