const fsp = require('node:fs/promises');
const path = require('node:path');
const { UserError, hashText, nowIso, truncate } = require('./util.cjs');

const MODEL_ID = 'bge-small-zh-v1.5';
const DIMS = 512;
const INDEX_VERSION = 2;
const CHUNK_CHARS = 700;
const CHUNK_OVERLAP = 120;
const MAX_CHUNKS_PER_NOTE = 60;
const MAX_BODY_CHARS = 90000;
const EMBED_BATCH = 12;
const MIN_VECTOR_SCORE = 0.14;
const VECTOR_SCORE_RATIO = 0.5;

function normalizeVector(vector) {
  let length = 0;
  for (let index = 0; index < vector.length; index += 1) length += vector[index] * vector[index];
  length = Math.sqrt(length);
  if (!length) return vector;
  const normalized = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) normalized[index] = vector[index] / length;
  return normalized;
}

function buildCenteredVectors(raw, mean) {
  const centered = new Float32Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    centered[index] = raw[index] - mean[index % DIMS];
  }
  const chunkCount = raw.length / DIMS;
  const result = new Float32Array(raw.length);
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    const offset = chunk * DIMS;
    const normalized = normalizeVector(centered.subarray(offset, offset + DIMS));
    result.set(normalized, offset);
  }
  return result;
}

function defaultModelRoot() {
  try {
    const { app } = require('electron');
    if (app?.isPackaged) return path.join(process.resourcesPath, 'models');
  } catch {
    // running outside Electron (tests)
  }
  return path.join(__dirname, '..', '..', 'build', 'models');
}

function stripMarkup(text) {
  return String(text || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function chunkNote(note) {
  const title = String(note.title || '').trim();
  const type = note.type || 'note';
  const body = String(note.body || '').trim();
  if (!body) return [];
  const source = body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body;
  const paragraphs = source
    .split(/\n\s*\n/)
    .map(stripMarkup)
    .filter(Boolean);
  const chunks = [];
  let buffer = '';
  const flush = () => {
    const text = buffer.trim();
    if (text.length >= 8) chunks.push(text);
    buffer = '';
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_CHARS) {
      flush();
      const step = CHUNK_CHARS - CHUNK_OVERLAP;
      for (let start = 0; start < paragraph.length; start += step) {
        const piece = paragraph.slice(start, start + CHUNK_CHARS).trim();
        if (piece.length >= 8) chunks.push(piece);
        if (start + CHUNK_CHARS >= paragraph.length) break;
      }
      continue;
    }
    if (!buffer) {
      buffer = paragraph;
    } else if (buffer.length + paragraph.length + 1 <= CHUNK_CHARS) {
      buffer += `\n${paragraph}`;
    } else {
      const previous = buffer;
      flush();
      const overlap = previous.slice(-CHUNK_OVERLAP);
      buffer = `${overlap}\n${paragraph}`.slice(0, CHUNK_CHARS);
    }
  }
  flush();
  const seen = new Set();
  const unique = chunks.filter((text) => {
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
  return unique.slice(0, MAX_CHUNKS_PER_NOTE).map((text, index) => {
    const labelled = title ? `《${title.slice(0, 80)}》\n${text}` : text;
    return {
      path: note.path,
      title,
      type,
      index,
      text: labelled,
      body: text,
      hash: hashText(labelled),
    };
  });
}

class RagService {
  constructor(vault, options = {}) {
    this.vault = vault;
    this.modelRoot = options.modelRoot || defaultModelRoot();
    this.embedFn = options.embedFn || null;
    this.onProgress = options.onProgress || null;
    this.indexDir = path.join(vault.root, '.zhiyu', 'rag');
    this.indexPath = path.join(this.indexDir, 'index.json');
    this.vectorsPath = path.join(this.indexDir, 'vectors.f32');
    this.index = null;
    this.vectors = null;
    this.centered = null;
    this.mean = null;
    this.loaded = false;
    this.building = false;
    this.cancelRequested = false;
    this.progress = null;
    this.pipeline = null;
    this.queryCache = new Map();
    this.buildPromise = null;
    this.updateTimer = null;
    this.autoTimer = null;
  }

  async load() {
    if (this.loaded) return this.index;
    this.loaded = true;
    try {
      const [rawIndex, buffer] = await Promise.all([
        fsp.readFile(this.indexPath, 'utf8'),
        fsp.readFile(this.vectorsPath),
      ]);
      const parsed = JSON.parse(rawIndex);
      if (
        parsed?.version !== INDEX_VERSION ||
        parsed?.model !== MODEL_ID ||
        parsed?.dims !== DIMS ||
        !Array.isArray(parsed?.mean) ||
        parsed.mean.length !== DIMS ||
        !Array.isArray(parsed?.chunks) ||
        parsed.chunks.length * DIMS * 4 !== buffer.byteLength
      ) {
        return null;
      }
      const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      this.index = parsed;
      this.mean = new Float32Array(parsed.mean);
      this.vectors = new Float32Array(copy);
      this.centered = buildCenteredVectors(this.vectors, this.mean);
    } catch {
      this.index = null;
      this.vectors = null;
      this.centered = null;
      this.mean = null;
    }
    return this.index;
  }

  async status() {
    await this.load();
    const index = this.index;
    return {
      ready: Boolean(index),
      building: this.building,
      model: MODEL_ID,
      bundled: true,
      notes: index ? Object.keys(index.notes || {}).length : 0,
      chunks: index?.chunks?.length || 0,
      builtAt: index?.builtAt || '',
      progress: this.building ? this.progress : null,
    };
  }

  emit(progress) {
    this.progress = progress;
    this.onProgress?.(progress);
  }

  async ensurePipeline() {
    if (this.embedFn) return;
    if (this.pipeline) return;
    const modelDir = path.join(this.modelRoot, MODEL_ID, 'onnx', 'model_quantized.onnx');
    const exists = await fsp
      .access(modelDir)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new UserError('语义模型文件缺失，请重新安装应用。');
    }
    const { env, pipeline } = await import('@xenova/transformers');
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useFSCache = false;
    env.localModelPath = `${this.modelRoot}${path.sep}`;
    env.cacheDir = this.modelRoot;
    this.pipeline = await pipeline('feature-extraction', MODEL_ID, { quantized: true });
  }

  async embedTexts(texts) {
    if (this.embedFn) return this.embedFn(texts);
    await this.ensurePipeline();
    const output = await this.pipeline(texts, { pooling: 'mean', normalize: true });
    const width = output.dims[output.dims.length - 1];
    const data = output.data;
    return texts.map((_, index) => new Float32Array(data.slice(index * width, (index + 1) * width)));
  }

  async embedQuery(text) {
    const input = truncate(String(text || ''), 500);
    const key = hashText(input);
    const cached = this.queryCache.get(key);
    if (cached) return cached;
    const [vector] = await this.embedTexts([input]);
    this.queryCache.set(key, vector);
    if (this.queryCache.size > 64) {
      const first = this.queryCache.keys().next().value;
      this.queryCache.delete(first);
    }
    return vector;
  }

  oldVectorByChunkHash() {
    const map = new Map();
    if (!this.index || !this.vectors) return map;
    for (const chunk of this.index.chunks) {
      if (typeof chunk.offset === 'number' && !map.has(chunk.hash)) {
        map.set(chunk.hash, this.vectors.subarray(chunk.offset, chunk.offset + DIMS));
      }
    }
    return map;
  }

  async runBuild() {
    this.building = true;
    this.cancelRequested = false;
    this.progress = null;
    try {
      this.emit({ phase: 'model', current: 0, total: 0, title: '加载语义模型' });
      await this.ensurePipeline();
      await this.load();
      const oldVectors = this.oldVectorByChunkHash();
      const metas = await this.vault.listNotes();
      this.emit({ phase: 'scan', current: 0, total: metas.length, title: '扫描知识库' });
      const chunks = [];
      const noteEntries = {};
      const pending = [];
      let reused = 0;
      let embedded = 0;

      const flush = async () => {
        if (!pending.length) return;
        if (this.cancelRequested) throw new UserError('已取消建立索引。');
        const vectors = await this.embedTexts(pending.map((item) => item.text));
        pending.forEach((item, index) => {
          chunks[item.chunkIndex].vector = vectors[index];
        });
        embedded += vectors.length;
        pending.length = 0;
      };

      for (let index = 0; index < metas.length; index += 1) {
        if (this.cancelRequested) throw new UserError('已取消建立索引。');
        const meta = metas[index];
        const note = await this.vault.readNote(meta.path).catch(() => null);
        if (!note) continue;
        const noteChunks = chunkNote(note);
        for (const chunk of noteChunks) {
          const chunkIndex = chunks.length;
          const cached = oldVectors.get(chunk.hash);
          if (cached) reused += 1;
          chunks.push({ ...chunk, vector: cached ? new Float32Array(cached) : null });
          if (!cached) {
            pending.push({ chunkIndex, text: chunk.text });
            if (pending.length >= EMBED_BATCH) await flush();
          }
        }
        noteEntries[note.path] = {
          title: note.title,
          type: note.type,
          updated: note.updated || '',
          chunkCount: noteChunks.length,
        };
        this.emit({
          phase: 'embed',
          current: index + 1,
          total: metas.length,
          title: note.title,
          embedded,
          reused,
        });
      }
      await flush();
      if (this.cancelRequested) throw new UserError('已取消建立索引。');

      const missing = chunks.find((chunk) => !chunk.vector);
      if (missing) throw new UserError('部分片段没有生成向量，请重试。');

      this.emit({ phase: 'write', current: metas.length, total: metas.length, title: '写入索引' });
      const vectors = new Float32Array(chunks.length * DIMS);
      const mean = new Float32Array(DIMS);
      const storedChunks = chunks.map((chunk, index) => {
        const offset = index * DIMS;
        vectors.set(chunk.vector, offset);
        return {
          path: chunk.path,
          title: chunk.title,
          type: chunk.type,
          text: chunk.text,
          hash: chunk.hash,
          offset,
        };
      });
      if (chunks.length) {
        for (const chunk of chunks) {
          for (let dimension = 0; dimension < DIMS; dimension += 1) {
            mean[dimension] += chunk.vector[dimension] / chunks.length;
          }
        }
      }
      const indexData = {
        version: INDEX_VERSION,
        model: MODEL_ID,
        dims: DIMS,
        mean: Array.from(mean),
        builtAt: nowIso(),
        notes: noteEntries,
        chunks: storedChunks,
      };
      await fsp.mkdir(this.indexDir, { recursive: true });
      const vectorsBuffer = Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength);
      await fsp.writeFile(`${this.vectorsPath}.tmp`, vectorsBuffer);
      await fsp.writeFile(`${this.indexPath}.tmp`, JSON.stringify(indexData), 'utf8');
      await fsp.rename(`${this.vectorsPath}.tmp`, this.vectorsPath);
      await fsp.rename(`${this.indexPath}.tmp`, this.indexPath);
      this.index = indexData;
      this.vectors = vectors;
      this.mean = mean;
      this.centered = buildCenteredVectors(vectors, mean);
      this.loaded = true;
      this.building = false;
      this.emit({
        phase: 'done',
        current: metas.length,
        total: metas.length,
        title: '索引已更新',
        embedded,
        reused,
        chunks: storedChunks.length,
        notes: Object.keys(noteEntries).length,
      });
      return await this.status();
    } catch (error) {
      this.building = false;
      this.emit({ phase: 'error', current: 0, total: 0, title: error.message });
      throw error;
    } finally {
      this.building = false;
      if (this.updatePending) {
        this.updatePending = false;
        void this.scheduleUpdate(1500);
      }
    }
  }

  build() {
    if (this.buildPromise) return this.buildPromise;
    this.buildPromise = this.runBuild().finally(() => {
      this.buildPromise = null;
    });
    return this.buildPromise;
  }

  cancel() {
    if (this.building) this.cancelRequested = true;
  }

  dispose() {
    this.cancel();
    if (this.updateTimer) clearTimeout(this.updateTimer);
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.updateTimer = null;
    this.autoTimer = null;
  }

  async startAutoBuild(delay = 2500) {
    await this.load();
    if (this.index || this.buildPromise || this.autoTimer) return;
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      void this.build().catch((error) => {
        console.warn('[rag] auto build failed:', error.message);
      });
    }, delay);
    this.autoTimer.unref?.();
  }

  async scheduleUpdate(delay = 8000) {
    await this.load();
    if (!this.index) return;
    if (this.building) {
      this.updatePending = true;
      return;
    }
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      void this.build().catch((error) => {
        console.warn('[rag] index update failed:', error.message);
      });
    }, delay);
    this.updateTimer.unref?.();
  }

  async search(query, limit = 6, { scope = 'all' } = {}) {
    const lexical = await this.vault.search(query, Math.max(12, limit * 2), { scope });
    await this.load();
    if (!this.index || !this.vectors || !this.index.chunks.length) return lexical;
    let queryVector;
    try {
      queryVector = await this.embedQuery(query);
    } catch (error) {
      console.warn('[rag] query embedding failed:', error.message);
      return lexical;
    }
    if (!this.centered) {
      this.centered = buildCenteredVectors(this.vectors, this.mean || new Float32Array(DIMS));
    }
    const mean = this.mean || new Float32Array(DIMS);
    const centeredQuery = new Float32Array(DIMS);
    for (let dimension = 0; dimension < DIMS; dimension += 1) {
      centeredQuery[dimension] = queryVector[dimension] - mean[dimension];
    }
    const normalizedQuery = normalizeVector(centeredQuery);
    const scored = [];
    for (const chunk of this.index.chunks) {
      if (scope === 'wiki' && chunk.type === 'raw') continue;
      if (scope === 'raw' && chunk.type !== 'raw') continue;
      let score = 0;
      for (let dimension = 0; dimension < DIMS; dimension += 1) {
        score += normalizedQuery[dimension] * this.centered[chunk.offset + dimension];
      }
      scored.push({ chunk, score });
    }
    scored.sort((left, right) => right.score - left.score);
    const floor = Math.max(MIN_VECTOR_SCORE, (scored[0]?.score || 0) * VECTOR_SCORE_RATIO);
    const byPath = new Map();
    for (const item of scored) {
      if (item.score < floor) break;
      if (byPath.size >= 24 && !byPath.has(item.chunk.path)) break;
      let group = byPath.get(item.chunk.path);
      if (!group) {
        group = {
          path: item.chunk.path,
          title: item.chunk.title,
          type: item.chunk.type,
          score: item.score,
          chunks: [],
        };
        byPath.set(item.chunk.path, group);
      }
      if (group.chunks.length < 2) group.chunks.push(item.chunk);
    }
    const vectorHits = [...byPath.values()].sort((a, b) => b.score - a.score).slice(0, 18);
    const existing = new Set();
    await Promise.all(
      vectorHits.map(async (hit) => {
        const found = await fsp
          .access(path.join(this.vault.root, hit.path))
          .then(() => true)
          .catch(() => false);
        if (found) existing.add(hit.path);
      }),
    );
    const usableVectors = vectorHits.filter((hit) => existing.has(hit.path));
    const lexicalTop = lexical[0]?.score || 0;
    const lexicalFloor = Math.max(2, lexicalTop * 0.2);
    const lexicalHits = lexical.filter((hit) => hit.score >= lexicalFloor);
    const queryText = String(query || '').trim().toLowerCase();
    const usableLexical = usableVectors.length
      ? lexicalHits
      : lexicalHits.filter(
          (hit) =>
            hit.score >= 12 || (queryText && hit.title.toLowerCase().includes(queryText)),
        );
    if (!usableVectors.length && !usableLexical.length) return [];
    const combined = new Map();
    const add = (hit, rank, weight, preferBody = false) => {
      if (!hit?.path) return;
      const previous = combined.get(hit.path);
      const score = weight / (60 + rank + 1);
      if (!previous) {
        combined.set(hit.path, { ...hit, score });
        return;
      }
      previous.score += score;
      if (preferBody && hit.body) previous.body = hit.body;
      else if (!previous.body && hit.body) previous.body = hit.body;
    };
    usableLexical.forEach((hit, index) => add(hit, index, hit.type === 'raw' ? 0.22 : 0.4));
    usableVectors.forEach((hit, index) => {
      add(
        {
          path: hit.path,
          title: hit.title,
          type: hit.type,
          body: hit.chunks.map((chunk) => chunk.text).join('\n\n'),
          excerpt: truncate(hit.chunks[0]?.body || '', 160),
        },
        index,
        hit.type === 'raw' ? 0.42 : 0.6,
        true,
      );
    });
    return [...combined.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((hit) => ({ ...hit, body: truncate(hit.body, 2600) }));
  }
}

module.exports = {
  RagService,
  chunkNote,
  MODEL_ID,
  DIMS,
  INDEX_VERSION,
};
