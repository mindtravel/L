import assert from 'node:assert/strict';
import { isSensitivePath, parseArgs } from '../scripts/release.mjs';

assert.deepEqual(parseArgs(['--message', '重构规则']), {
  message: '重构规则', push: true, dryRun: false, audit: true
});
assert.deepEqual(parseArgs(['-m', '本地提交', '--no-push', '--dry-run', '--no-audit']), {
  message: '本地提交', push: false, dryRun: true, audit: false
});
assert.equal(isSensitivePath('.env.production'), true);
assert.equal(isSensitivePath('.env.example'), false);
assert.equal(isSensitivePath('certs/server.pem'), true);
assert.equal(isSensitivePath('js/main.mjs'), false);
assert.throws(() => parseArgs(['--unknown']), /未知参数/);
console.log('Release script tests: passed');
