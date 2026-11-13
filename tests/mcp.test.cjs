const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { McpService } = require('../electron/lib/mcp.cjs');

test('MCP stdio 连接、列工具与调用', async () => {
  const fixture = path.join(__dirname, 'fixtures', 'mcp-echo-server.cjs');
  const settings = {
    get: () => ({
      mcpServers: [
        {
          id: 'echo',
          name: 'Echo',
          command: process.execPath,
          args: [fixture],
          enabled: true,
        },
      ],
    }),
  };
  const service = new McpService(settings);
  try {
    const status = await service.ensure();
    assert.equal(status.errors.length, 0);
    assert.equal(status.tools.length, 1);
    assert.equal(status.tools[0].name, 'mcp__echo__echo');
    const result = await service.callTool('mcp__echo__echo', { text: '你好' });
    assert.ok(result.text.includes('echo: 你好'));
  } finally {
    await service.close();
  }
});