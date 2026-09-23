#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const options = { message: null, push: true, dryRun: false, audit: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--message' || arg === '-m') {
      options.message = argv[++index] || null;
    } else if (arg === '--no-push') {
      options.push = false;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--no-audit') {
      options.audit = false;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error('未知参数：' + arg);
    }
  }
  if (options.message != null && !options.message.trim()) options.message = null;
  return options;
}

export function isSensitivePath(file) {
  const normalized = file.replaceAll('\\', '/');
  if (/(^|\/)\.env\.example$/i.test(normalized)) return false;
  return /(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12))$/i.test(normalized);
}

function run(command, args, { capture = false } = {}) {
  const output = execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  return capture ? output.trim() : '';
}

function listChanges() {
  return run('git', ['status', '--short'], { capture: true });
}

function currentBranch() {
  const branch = run('git', ['branch', '--show-current'], { capture: true });
  if (!branch) throw new Error('当前不在一个可发布的分支上');
  return branch;
}

export async function release(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：npm run release -- --message "说明" [--no-push] [--dry-run] [--no-audit]');
    return;
  }
  if (!options.message) throw new Error('必须提供提交说明：--message "说明"');
  const branch = currentBranch();
  const changes = listChanges();
  if (!changes) throw new Error('工作区没有变化，无需发布');

  console.log('发布分支：' + branch);
  console.log('待提交变更：\n' + changes);
  if (options.dryRun) {
    console.log('dry-run：不会运行提交、推送或部署。');
    return;
  }

  if (run('git', ['diff', '--cached', '--name-only'], { capture: true })) {
    throw new Error('已有暂存内容，请先提交或取消暂存后再发布');
  }
  run('npm', ['test']);
  if (options.audit) run('npm', ['audit', '--omit=dev']);
  run('git', ['diff', '--check']);
  run('git', ['add', '-A']);
  const staged = run('git', ['diff', '--cached', '--name-only'], { capture: true })
    .split('\n').filter(Boolean);
  const sensitive = staged.filter(isSensitivePath);
  if (sensitive.length) {
    run('git', ['reset'], { capture: true });
    throw new Error('检测到疑似密钥文件，已取消提交：\n' + sensitive.join('\n'));
  }
  if (!staged.length) throw new Error('没有可提交的文件');

  run('git', ['commit', '-m', options.message]);
  if (options.push) {
    run('git', ['push', 'origin', branch]);
    console.log('已推送 origin/' + branch + '，Render 将按 GitHub 设置自动部署。');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  release().catch(error => {
    console.error('发布失败：' + error.message);
    process.exitCode = 1;
  });
}
