// nodejs_compat 提供的 node:async_hooks（Cloudflare 与 Docker 的 workerd 都可用）；只声明 Worker 用到的部分，不引入整套 Node 类型
declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined;
    run<R>(store: T, fn: () => R): R;
  }
}
