const readline = require('node:readline');

const rl = readline.createInterface({ input: process.stdin });
const send = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);

rl.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (!request || !request.method) return;
  if (request.method.startsWith('notifications/')) return;

  if (request.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'echo', version: '1.0.0' },
      },
    });
    return;
  }
  if (request.method === 'ping') {
    send({ jsonrpc: '2.0', id: request.id, result: {} });
    return;
  }
  if (request.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [
          {
            name: 'echo',
            description: '回显传入的文本',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
        ],
      },
    });
    return;
  }
  if (request.method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: `echo: ${request.params?.arguments?.text || ''}`,
          },
        ],
        isError: false,
      },
    });
    return;
  }
  send({
    jsonrpc: '2.0',
    id: request.id,
    error: { code: -32601, message: `Unknown method: ${request.method}` },
  });
});