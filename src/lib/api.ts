import type { ZhiyuApi } from '../types';

const native = window.zhiyu;

export const usingMock = !native;

export const api: ZhiyuApi = native ?? (await import('./mock')).mockApi;

export function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
  }
  return String(error || '操作没有完成，请重试');
}
