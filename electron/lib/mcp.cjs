const { UserError } = require('./util.cjs');

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

class McpService {
  constructor(settings) {
    this.settings = settings;
    this.clients = new Map();
    this.toolDefs = [];
    this.errors = [];
    this.signature = '';
    this.connecting = null;
  }

  configs() {
    const list = this.settings.get().mcpServers;
    return Array.isArray(list)
      ? list.filter(
          (item) =>
            item &&
            item.enabled !== false &&
            typeof item.command === 'string' &&
            item.command.trim(),
        )
      : [];
  }

  async ensure() {
    const configs = this.configs();
    const signature = JSON.stringify(configs);
    if (signature === this.signature && (this.clients.size || !configs.length)) {
      return this.status();
    }
    if (this.connecting) return this.connecting;
    this.connecting = this.connectAll(configs, signature).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async connectAll(configs, signature) {
    await this.close();
    this.toolDefs = [];
    this.errors = [];
    if (!configs.length) {
      this.signature = signature;
      return this.status();
    }
    let Client;
    let StdioClientTransport;
    let getDefaultEnvironment;
    try {
      const clientModule = await import('@modelcontextprotocol/sdk/client/index.js');
      const stdioModule = await import('@modelcontextprotocol/sdk/client/stdio.js');
      Client = clientModule.Client;
      StdioClientTransport = stdioModule.StdioClientTransport;
      getDefaultEnvironment = stdioModule.getDefaultEnvironment;
    } catch (error) {
      this.errors.push({ serverId: 'sdk', name: 'MCP SDK', message: error.message });
      this.signature = signature;
      return this.status();
    }

    for (const config of configs) {
      const serverId = String(config.id || config.name || config.command).replace(/[^\w-]/g, '-');
      const serverName = String(config.name || serverId);
      try {
        const env = {
          ...(typeof getDefaultEnvironment === 'function' ? getDefaultEnvironment() : process.env),
          ...(config.env && typeof config.env === 'object' ? config.env : {}),
        };
        const commandText = String(config.command);
        const args = Array.isArray(config.args) ? config.args.map(String) : [];
        const needsCmd =
          process.platform === 'win32' &&
          (/^(npx|npm|pnpm|yarn)$/i.test(commandText) || /\.(cmd|bat)$/i.test(commandText));
        const transport = new StdioClientTransport({
          command: needsCmd ? process.env.ComSpec || 'cmd.exe' : commandText,
          args: needsCmd ? ['/c', commandText, ...args] : args,
          env,
          stderr: 'pipe',
        });
        const client = new Client(
          { name: 'zhiyu', version: '1.0.0' },
          { capabilities: {} },
        );
        await withTimeout(client.connect(transport), 20000, `连接 MCP 服务 ${serverName}`);
        const listed = await withTimeout(client.listTools(), 15000, `读取 ${serverName} 工具`);
        const tools = Array.isArray(listed?.tools) ? listed.tools : [];
        for (const tool of tools) {
          if (!tool?.name) continue;
          this.toolDefs.push({
            serverId,
            serverName,
            name: String(tool.name),
            fullName: `mcp__${serverId}__${tool.name}`,
            description: String(tool.description || '').slice(0, 500),
            inputSchema: tool.inputSchema || { type: 'object', properties: {} },
          });
        }
        this.clients.set(serverId, { client, transport, name: serverName, toolCount: tools.length });
      } catch (error) {
        this.errors.push({ serverId, name: serverName, message: error.message || '连接失败' });
      }
    }
    this.signature = signature;
    return this.status();
  }

  status() {
    const servers = this.configs().map((config) => {
      const serverId = String(config.id || config.name || config.command).replace(/[^\w-]/g, '-');
      const connected = this.clients.get(serverId);
      return {
        id: serverId,
        name: String(config.name || serverId),
        connected: Boolean(connected),
        toolCount: connected?.toolCount || 0,
      };
    });
    return {
      servers,
      tools: this.toolDefs.map((tool) => ({
        name: tool.fullName,
        title: tool.name,
        description: tool.description,
        serverId: tool.serverId,
        serverName: tool.serverName,
      })),
      errors: this.errors,
    };
  }

  getToolDefs() {
    return this.toolDefs;
  }

  async callTool(fullName, args = {}) {
    const tool = this.toolDefs.find((item) => item.fullName === fullName);
    if (!tool) throw new UserError(`MCP 工具不存在：${fullName}`);
    const connection = this.clients.get(tool.serverId);
    if (!connection) throw new UserError(`MCP 服务未连接：${tool.serverName}`);
    const result = await withTimeout(
      connection.client.callTool({
        name: tool.name,
        arguments: args && typeof args === 'object' ? args : {},
      }),
      30000,
      `调用 MCP 工具 ${tool.name}`,
    );
    const parts = Array.isArray(result?.content)
      ? result.content
          .map((part) => {
            if (typeof part === 'string') return part;
            if (part?.type === 'text') return String(part.text || '');
            if (part?.type === 'image') return '[图片结果]';
            return '';
          })
          .filter(Boolean)
      : [];
    return {
      text: parts.join('\n\n') || '(工具没有返回文本内容)',
      isError: Boolean(result?.isError),
    };
  }

  async refresh() {
    this.signature = '';
    return this.ensure();
  }

  async close() {
    for (const connection of this.clients.values()) {
      try {
        await connection.client.close();
      } catch {
        // ignore
      }
      try {
        await connection.transport.close();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.toolDefs = [];
    this.signature = '';
  }
}

module.exports = { McpService };