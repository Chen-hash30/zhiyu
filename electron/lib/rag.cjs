const fsp = require('node:fs/promises');
const path = require('node:path');
const { UserError, hashText, nowIso, truncate } = require('./util.cjs');

const ENGINES = {
  zh: { key: 'zh', model: 'bge-small-zh-v1.5', dims: 512 },
  en: { key: 'en', model: 'bge-small-en-v1.5', dims: 384 },
};
const ENGINE_LIST = Object.values(ENGINES);
const DIMS = ENGINES.zh.dims;
const INDEX_VERSION = 3;
const CHUNK_CHARS = 700;
const CHUNK_OVERLAP = 120;
const MAX_CHUNKS_PER_NOTE = 60;
const MAX_BODY_CHARS = 90000;
const EMBED_BATCH = 12;
const MIN_VECTOR_SCORE = 0.14;
const VECTOR_SCORE_RATIO = 0.5;
const MIN_CENTER_CHUNKS = 4;

function detectLanguages(text) {
  const value = String(text || '');
  const hasCjk = /[\u3400-\u9fff]/.test(value);
  const hasLatin = /[A-Za-z]/.test(value);
  if (hasCjk && hasLatin) return ['zh', 'en'];
  if (hasCjk) return ['zh'];
  if (hasLatin) return ['en'];
  return ['zh'];
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

function normalizeVector(vector) {
  let length = 0;
  for (let index = 0; index < vector.length; index += 1) length += vector[index] * vector[index];
  length = Math.sqrt(length);
  if (!length) return vector;
  const normalized = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) normalized[index] = vector[index] / length;
  return normalized;
}

function buildCenteredVectors(raw, mean, dims) {
  const centered = new Float32Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    centered[index] = raw[index] - mean[index % dims];
  }
  const chunkCount = raw.length / dims;
  const result = new Float32Array(raw.length);
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    const offset = chunk * dims;
    const normalized = normalizeVector(centered.subarray(offset, offset + dims));
    result.set(normalized, offset);
  }
  return result;
}

class RagService {
  constructor(vault, options = {}) {
    this.vault = vault;
    this.modelRoot = options.modelRoot || defaultModelRoot();
    this.embedFn = options.embedFn || null;
    this.onProgress = options.onProgress || null;
    this.ragRoot = path.join(vault.root, '.zhiyu', 'rag');
    this.engines = new Map(
      ENGINE_LIST.map((config) => [
        config.key,
        {
          ...config,
          dir: path.join(this.ragRoot, config.key),
          indexPath: path.join(this.ragRoot, config.key, 'index.json'),
          vectorsPath: path.join(this.ragRoot, config.key, 'vectors.f32'),
          index: null,
          vectors: null,
          centered: null,
          mean: null,
          center: false,
          loaded: false,
          pipeline: null,
        },
      ]),
    );
    this.loaded = false;
    this.building = false;
    this.cancelRequested = false;
    this.progress = null;
    this.queryCache = new Map();
    this.buildPromise = null;
    this.updateTimer = null;
    this.autoTimer = null;
  }

  engineList() {
    return [...this.engines.values()];
  }

  async loadEngine(engine) {
    if (engine.loaded) return;
    engine.loaded = true;
    try {
      const [rawIndex, buffer] = await Promise.all([
        fsp.readFile(engine.indexPath, 'utf8'),
        fsp.readFile(engine.vectorsPath),
      ]);
      const parsed = JSON.parse(rawIndex);
      if (
        parsed?.version !== INDEX_VERSION ||
        parsed?.engine !== engine.key ||
        parsed?.model !== engine.model ||
        parsed?.dims !== engine.dims ||
        !Array.isArray(parsed?.mean) ||
        parsed.mean.length !== engine.dims ||
        !Array.isArray(parsed?.chunks) ||
        parsed.chunks.length * engine.dims * 4 !== buffer.byteLength
      ) {
        return;
      }
      const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      engine.index = parsed;
      engine.center =
        parsed.center === true ||
        (parsed.center === undefined && parsed.chunks.length >= MIN_CENTER_CHUNKS);
      engine.mean = engine.center ? new Float32Array(parsed.mean) : new Float32Array(engine.dims);
      engine.vectors = new Float32Array(copy);
      engine.centered = engine.center
        ? buildCenteredVectors(engine.vectors, engine.mean, engine.dims)
        : engine.vectors;
    } catch {
      engine.index = null;
      engine.vectors = null;
      engine.centered = null;
      engine.mean = null;
      engine.center = false;
    }
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    await Promise.all(this.engineList().map((engine) => this.loadEngine(engine)));
  }

  async status() {
    await this.load();
    const engines = this.engineList().map((engine) => ({
      key: engine.key,
      model: engine.model,
      notes: Object.keys(engine.index?.notes || {}).length,
      chunks: engine.index?.chunks?.length || 0,
    }));
    const notes = new Set();
    const chunks = new Set();
    let builtAt = '';
    for (const engine of this.engineList()) {
      if (!engine.index) continue;
      Object.keys(engine.index.notes || {}).forEach((notePath) => notes.add(notePath));
      for (const chunk of engine.index.chunks || []) chunks.add(`${chunk.path}\u0000${chunk.hash}`);
      if (engine.index.builtAt > builtAt) builtAt = engine.index.builtAt;
    }
    return {
      ready: this.engineList().every((engine) => Boolean(engine.index)),
      building: this.building,
      model: '中英双引擎',
      bundled: true,
      notes: notes.size,
      chunks: chunks.size,
      builtAt,
      engines,
      progress: this.building ? this.progress : null,
    };
  }

  emit(progress) {
    this.progress = progress;
    this.onProgress?.(progress);
  }

  async ensurePipeline(engine) {
    if (this.embedFn || engine.pipeline) return;
    const modelFile = path.join(this.modelRoot, engine.model, 'onnx', 'model_quantized.onnx');
    const exists = await fsp
      .access(modelFile)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new UserError(`语义模型 ${engine.model} 缺失，请重新安装应用。`);
    }
    const { env, pipeline } = await import('@xenova/transformers');
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useFSCache = false;
    env.localModelPath = `${this.modelRoot}${path.sep}`;
    env.cacheDir = this.modelRoot;
    engine.pipeline = await pipeline('feature-extraction', engine.model, { quantized: true });
  }

  async embedTexts(engine, texts) {
    if (this.embedFn) return this.embedFn(texts, engine);
    await this.ensurePipeline(engine);
    const output = await engine.pipeline(texts, { pooling: 'mean', normalize: true });
    const width = output.dims[output.dims.length - 1];
    const data = output.data;
    return texts.map((_, index) => new Float32Array(data.slice(index * width, (index + 1) * width)));
  }

  async embedQuery(engine, text) {
    const input = truncate(String(text || ''), 500);
    const key = `${engine.key}:${hashText(input)}`;
    const cached = this.queryCache.get(key);
    if (cached) return cached;
    const [vector] = await this.embedTexts(engine, [input]);
    this.queryCache.set(key, vector);
    if (this.queryCache.size > 96) {
      const first = this.queryCache.keys().next().value;
      this.queryCache.delete(first);
    }
    return vector;
  }

  oldVectorByChunkHash(engine) {
    const map = new Map();
    if (!engine.index || !engine.vectors) return map;
    for (const chunk of engine.index.chunks) {
      if (typeof chunk.offset === 'number' && !map.has(chunk.hash)) {
        map.set(chunk.hash, engine.vectors.subarray(chunk.offset, chunk.offset + engine.dims));
      }
    }
    return map;
  }

  async writeEngine(engine, bucket) {
    const vectors = new Float32Array(bucket.chunks.length * engine.dims);
    const center = bucket.chunks.length >= MIN_CENTER_CHUNKS;
    const mean = new Float32Array(engine.dims);
    const storedChunks = bucket.chunks.map((chunk, index) => {
      const offset = index * engine.dims;
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
    if (center) {
      for (const chunk of bucket.chunks) {
        for (let dimension = 0; dimension < engine.dims; dimension += 1) {
          mean[dimension] += chunk.vector[dimension] / bucket.chunks.length;
        }
      }
    }
    const indexData = {
      version: INDEX_VERSION,
      engine: engine.key,
      model: engine.model,
      dims: engine.dims,
      mean: Array.from(mean),
      center,
      builtAt: nowIso(),
      notes: bucket.notes,
      chunks: storedChunks,
    };
    await fsp.mkdir(engine.dir, { recursive: true });
    const vectorsBuffer = Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength);
    await fsp.writeFile(`${engine.vectorsPath}.tmp`, vectorsBuffer);
    await fsp.writeFile(`${engine.indexPath}.tmp`, JSON.stringify(indexData), 'utf8');
    await fsp.rename(`${engine.vectorsPath}.tmp`, engine.vectorsPath);
    await fsp.rename(`${engine.indexPath}.tmp`, engine.indexPath);
    engine.index = indexData;
    engine.vectors = vectors;
    engine.center = center;
    engine.mean = mean;
    engine.centered = center ? buildCenteredVectors(vectors, mean, engine.dims) : vectors;
    engine.loaded = true;
  }

  async runBuild() {
    this.building = true;
    this.cancelRequested = false;
    this.progress = null;
    try {
      this.emit({ phase: 'model', current: 0, total: 0, title: '准备中英语义模型' });
      await this.load();
      const oldVectors = new Map(
        this.engineList().map((engine) => [engine.key, this.oldVectorByChunkHash(engine)]),
      );
      const buckets = new Map(
        this.engineList().map((engine) => [
          engine.key,
          { chunks: [], notes: {}, pending: [] },
        ]),
      );
      const metas = await this.vault.listNotes();
      this.emit({ phase: 'scan', current: 0, total: metas.length, title: '扫描知识库' });
      let embedded = 0;
      let reused = 0;

      const flushEngine = async (engineKey) => {
        const engine = this.engines.get(engineKey);
        const bucket = buckets.get(engineKey);
        if (!bucket.pending.length) return;
        if (this.cancelRequested) throw new UserError('已取消建立索引。');
        const vectors = await this.embedTexts(
          engine,
          bucket.pending.map((item) => item.text),
        );
        bucket.pending.forEach((item, index) => {
          bucket.chunks[item.chunkIndex].vector = vectors[index];
        });
        embedded += vectors.length;
        bucket.pending = [];
      };

      for (let index = 0; index < metas.length; index += 1) {
        if (this.cancelRequested) throw new UserError('已取消建立索引。');
        const meta = metas[index];
        const note = await this.vault.readNote(meta.path).catch(() => null);
        if (!note) continue;
        for (const chunk of chunkNote(note)) {
          for (const engineKey of detectLanguages(chunk.text)) {
            const engine = this.engines.get(engineKey);
            const bucket = buckets.get(engineKey);
            const cached = oldVectors.get(engineKey).get(chunk.hash);
            const chunkIndex = bucket.chunks.length;
            if (cached) reused += 1;
            bucket.chunks.push({
              ...chunk,
              vector: cached ? new Float32Array(cached) : null,
            });
            if (!bucket.notes[note.path]) {
              bucket.notes[note.path] = {
                title: note.title,
                type: note.type,
                updated: note.updated || '',
                chunkCount: 0,
              };
            }
            bucket.notes[note.path].chunkCount += 1;
            if (!cached) {
              bucket.pending.push({ chunkIndex, text: chunk.text });
              if (bucket.pending.length >= EMBED_BATCH) await flushEngine(engineKey);
            }
          }
        }
        this.emit({
          phase: 'embed',
          current: index + 1,
          total: metas.length,
          title: note.title,
          embedded,
          reused,
        });
      }
      for (const engine of this.engineList()) await flushEngine(engine.key);
      if (this.cancelRequested) throw new UserError('已取消建立索引。');
      const missing = this.engineList().find((engine) =>
        buckets.get(engine.key).chunks.some((chunk) => !chunk.vector),
      );
      if (missing) throw new UserError(`${missing.model} 有片段没有生成向量，请重试。`);

      this.emit({ phase: 'write', current: metas.length, total: metas.length, title: '写入索引' });
      for (const engine of this.engineList()) {
        await this.writeEngine(engine, buckets.get(engine.key));
      }
      this.building = false;
      const result = await this.status();
      this.emit({
        phase: 'done',
        current: metas.length,
        total: metas.length,
        title: '索引已更新',
        embedded,
        reused,
        chunks: result.chunks,
        notes: result.notes,
      });
      return result;
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
    if (this.engineList().every((engine) => engine.index) || this.buildPromise || this.autoTimer) {
      return;
    }
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
    if (!this.engineList().some((engine) => engine.index)) return;
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

  async vectorGroups(engine, query) {
    if (!engine.index?.chunks?.length) return [];
    const useCenter = engine.center === true;
    if (useCenter && !engine.centered) {
      engine.centered = buildCenteredVectors(
        engine.vectors,
        engine.mean || new Float32Array(engine.dims),
        engine.dims,
      );
    }
    let queryVector;
    try {
      queryVector = await this.embedQuery(engine, query);
    } catch (error) {
      console.warn('[rag] query embedding failed:', error.message);
      return [];
    }
    const source = useCenter ? engine.centered : engine.vectors;
    let normalized = queryVector;
    if (useCenter) {
      const mean = engine.mean || new Float32Array(engine.dims);
      const centered = new Float32Array(engine.dims);
      for (let dimension = 0; dimension < engine.dims; dimension += 1) {
        centered[dimension] = queryVector[dimension] - mean[dimension];
      }
      normalized = normalizeVector(centered);
    }
    const scored = [];
    for (const chunk of engine.index.chunks) {
      let score = 0;
      for (let dimension = 0; dimension < engine.dims; dimension += 1) {
        score += normalized[dimension] * source[chunk.offset + dimension];
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
    return [...byPath.values()].sort((a, b) => b.score - a.score).slice(0, 18);
  }

  async search(query, limit = 6, { scope = 'all' } = {}) {
    const lexical = await this.vault.search(query, Math.max(12, limit * 2), { scope });
    await this.load();
    const languages = detectLanguages(query).filter(
      (key) => this.engines.get(key)?.index?.chunks?.length,
    );
    const vectorHits = [];
    for (const key of languages) {
      const engine = this.engines.get(key);
      vectorHits.push(...(await this.vectorGroups(engine, query)));
    }
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
    const usableVectors = vectorHits
      .filter((hit) => existing.has(hit.path))
      .filter((hit) => scope !== 'wiki' || hit.type !== 'raw')
      .filter((hit) => scope !== 'raw' || hit.type === 'raw');
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
  detectLanguages,
  ENGINES,
  MODEL_ID: ENGINES.zh.model,
  DIMS,
  INDEX_VERSION,
};
