const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

const DEFAULTS = {
  theme: 'system',
  vaultPath: null,
  recentVaults: [],
  windowBounds: null,
  gitAutoSnapshot: true,
  snapshotDir: '',
  mcpServers: [],
  ai: {
    preset: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    thinkingModel: '',
    contextWindow: 128000,
    autoCompress: true,
    keyEnc: '',
  },
};

class SettingsStore {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.data = this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULTS,
        ...parsed,
        ai: { ...DEFAULTS.ai, ...(parsed.ai || {}) },
        recentVaults: Array.isArray(parsed.recentVaults) ? parsed.recentVaults : [],
      };
    } catch {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }

  get() {
    return this.data;
  }

  update(patch = {}) {
    const next = { ...this.data, ...patch };
    if (patch.ai) {
      next.ai = { ...this.data.ai, ...patch.ai };
    }
    this.data = next;
    this.save();
    return this.data;
  }

  setVault(vaultPath) {
    const recentVaults = [
      vaultPath,
      ...this.data.recentVaults.filter((item) => item !== vaultPath),
    ].slice(0, 6);
    this.data = { ...this.data, vaultPath, recentVaults };
    this.save();
  }

  removeRecent(vaultPath) {
    this.data = {
      ...this.data,
      recentVaults: this.data.recentVaults.filter((item) => item !== vaultPath),
      vaultPath: this.data.vaultPath === vaultPath ? null : this.data.vaultPath,
    };
    this.save();
  }

  setKey(plainText) {
    const key = String(plainText || '').trim();
    if (!key) {
      this.data.ai = { ...this.data.ai, keyEnc: '' };
      this.save();
      return;
    }
    let value;
    try {
      value = `enc:${safeStorage.encryptString(key).toString('base64')}`;
    } catch {
      value = `raw:${Buffer.from(key, 'utf8').toString('base64')}`;
    }
    this.data.ai = { ...this.data.ai, keyEnc: value };
    this.save();
  }

  getKey() {
    const stored = this.data.ai.keyEnc;
    if (!stored) return '';
    try {
      if (stored.startsWith('enc:')) {
        return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
      }
      if (stored.startsWith('raw:')) {
        return Buffer.from(stored.slice(4), 'base64').toString('utf8');
      }
      return stored;
    } catch {
      return '';
    }
  }

  hasKey() {
    return Boolean(this.data.ai.keyEnc);
  }

  publicSettings() {
    const { ai, ...rest } = this.data;
    return {
      ...rest,
      ai: {
        preset: ai.preset,
        baseUrl: ai.baseUrl,
        model: ai.model,
        thinkingModel: ai.thinkingModel || '',
        contextWindow: Number(ai.contextWindow) || 128000,
        autoCompress: ai.autoCompress !== false,
        hasKey: Boolean(ai.keyEnc),
      },
    };
  }
}

module.exports = { SettingsStore, DEFAULTS };
