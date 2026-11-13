import http from 'node:http';

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
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
      return;
    }
    if (payload.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: '这是来自真实 Electron 对话的测试回答。' } }] })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    const content = JSON.stringify({
      summary: '把欢迎资料整理成一个测试概念',
      pages: [
        {
          type: 'concept',
          title: '测试概念',
          slug: 'test-concept',
          aliases: ['Test Concept'],
          tags: ['测试', '自动化'],
          body: '测试概念用于验证真实的 Electron 整理链路。\n\n它从收件箱里的欢迎资料整理而来，并通过 [[第二大脑]] 建立连接。',
        },
      ],
      log: '整理《欢迎来到知屿》· 新增 1 个条目',
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});

server.listen(8788, '127.0.0.1', () => {
  console.log('mock model ready on 8788');
});
