import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS = ['bge-small-zh-v1.5', 'bge-small-en-v1.5'];
const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];
const REMOTES = ['https://hf-mirror.com', 'https://huggingface.co'];
const force = process.argv.includes('--force');

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const total = Number(response.headers.get('content-length')) || 0;
  const temp = `${destination}.part`;
  let received = 0;
  let lastReport = 0;
  const writer = fs.createWriteStream(temp);
  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => {
    received += chunk.length;
    const now = Date.now();
    if (now - lastReport < 500) return;
    lastReport = now;
    const progress = total ? ` ${Math.round((received / total) * 100)}%` : '';
    process.stdout.write(`\r  ${formatMb(received)} / ${formatMb(total)}${progress}`);
  });
  await pipeline(source, writer);
  process.stdout.write('\n');
  await fsp.rename(temp, destination);
}

async function downloadModel(model) {
  const targetRoot = path.join(__dirname, '..', 'build', 'models', model);
  await fsp.mkdir(path.join(targetRoot, 'onnx'), { recursive: true });
  for (const file of FILES) {
    const destination = path.join(targetRoot, file);
    if (!force) {
      const stat = await fsp.stat(destination).catch(() => null);
      if (stat?.size > 0) {
        console.log(`skip ${model}/${file}`);
        continue;
      }
    }
    let downloaded = false;
    let lastError = null;
    for (const remote of REMOTES) {
      const url = `${remote}/Xenova/${model}/resolve/main/${file}`;
      console.log(`fetch ${model}/${file} from ${remote}`);
      try {
        await download(url, destination);
        downloaded = true;
        break;
      } catch (error) {
        lastError = error;
        console.warn(`  failed: ${error.message}`);
      }
    }
    if (!downloaded) {
      throw new Error(`无法下载 ${model}/${file}: ${lastError?.message || '未知错误'}`);
    }
  }
  console.log(`模型已就绪: ${targetRoot}`);
}

async function main() {
  for (const model of MODELS) await downloadModel(model);
  console.log('\n中英双引擎模型已就绪，现在可以运行 npm run dev 或 npm run dist。');
}

main().catch((error) => {
  console.error(`\n模型准备失败: ${error.message}`);
  process.exitCode = 1;
});
