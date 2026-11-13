import type { ZhiyuApi } from './types';

declare global {
  interface Window {
    zhiyu?: ZhiyuApi;
  }
}

export {};
