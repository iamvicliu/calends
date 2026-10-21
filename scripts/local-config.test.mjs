import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { resolveLocalDir, resolveWranglerArgs } from './local-config.mjs';

const ROOT = resolve('/workspace/calends');
const STATE = join(ROOT, '.wrangler/state');
const ENV = { CALENDS_LOCAL: '../my deploy' };
const CONFIG = join(resolve(ROOT, ENV.CALENDS_LOCAL), 'wrangler.jsonc');

test('未设置或为空时使用仓库内 local/，不依赖当前工作目录', () => {
  assert.equal(resolveLocalDir({}, ROOT), join(ROOT, 'local'));
  assert.equal(resolveLocalDir({ CALENDS_LOCAL: '' }, ROOT), join(ROOT, 'local'));
});

test('相对目录从仓库根目录解析，支持仓库外目录和空格', () => {
  assert.equal(resolveLocalDir(ENV, ROOT), resolve(ROOT, '../my deploy'));
  assert.equal(resolveLocalDir({ CALENDS_LOCAL: 'personal/../config' }, ROOT), join(ROOT, 'config'));
});

test('绝对目录保持绝对定位', () => {
  const dir = resolve('/external/my-deploy');
  assert.equal(resolveLocalDir({ CALENDS_LOCAL: dir }, ROOT), dir);
});

test('存在个人配置时传入完整路径，且不修改原始参数', () => {
  const args = ['deploy', '--dry-run'];
  const result = resolveWranglerArgs(args, ENV, ROOT, (file) => file === CONFIG);
  assert.deepEqual(result, ['deploy', '--dry-run', '--config', CONFIG]);
  assert.deepEqual(args, ['deploy', '--dry-run']);
  assert.deepEqual(
    resolveWranglerArgs(['secret', 'put', 'SETUP_TOKEN'], ENV, ROOT, () => true),
    ['secret', 'put', 'SETUP_TOKEN', '--config', CONFIG],
  );
});

test('默认目录仍自动选用 local/wrangler.jsonc', () => {
  const config = join(ROOT, 'local/wrangler.jsonc');
  assert.deepEqual(
    resolveWranglerArgs(['deploy'], {}, ROOT, (file) => file === config),
    ['deploy', '--config', config],
  );
});

test('个人配置不存在时保留 Wrangler 的默认配置选择', () => {
  for (const env of [{}, ENV]) {
    assert.deepEqual(
      resolveWranglerArgs(['deploy'], env, ROOT, () => false),
      ['deploy'],
    );
  }
});

for (const flags of [['--config', 'custom.jsonc'], ['-c', 'custom.jsonc'], ['--config=custom.jsonc'], ['-c=custom.jsonc'], ['-ccustom.jsonc']]) {
  test(`显式配置 ${flags.join(' ')} 不被个人配置覆盖`, () => {
    const args = ['deploy', ...flags];
    assert.deepEqual(
      resolveWranglerArgs(args, ENV, ROOT, () => {
        assert.fail('显式配置不应检查个人配置文件');
      }),
      args,
    );
  });
}

test('本地 dev 与迁移固定使用仓库的数据目录，不随配置目录改变', () => {
  for (const args of [['dev'], ['d1', 'migrations', 'apply', 'DB', '--local']]) {
    for (const env of [{}, ENV, { CALENDS_LOCAL: resolve('/external/config') }]) {
      assert.deepEqual(
        resolveWranglerArgs(args, env, ROOT, () => false),
        [...args, '--persist-to', STATE],
      );
      assert.deepEqual(
        resolveWranglerArgs(args, env, ROOT, () => true),
        [...args, '--config', join(resolveLocalDir(env, ROOT), 'wrangler.jsonc'), '--persist-to', STATE],
      );
    }
  }
});

test('显式配置不改变本地持久化默认路径', () => {
  const args = ['dev', '--config', 'custom.jsonc'];
  assert.deepEqual(
    resolveWranglerArgs(args, ENV, ROOT, () => true),
    [...args, '--persist-to', STATE],
  );
});

test('尊重显式持久化路径，远程命令不注入本地数据目录', () => {
  for (const flags of [['--persist-to', '/isolated/state'], ['--persist-to=/isolated/state']]) {
    const args = ['dev', ...flags];
    assert.deepEqual(
      resolveWranglerArgs(args, ENV, ROOT, () => false),
      args,
    );
  }
  const args = ['d1', 'migrations', 'apply', 'DB', '--remote'];
  assert.deepEqual(
    resolveWranglerArgs(args, ENV, ROOT, () => false),
    args,
  );
});
