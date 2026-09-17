// Local review probes: no live KV, Telegram, credentials, or browser network.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto, createHash } = require('node:crypto');
const path = require('node:path');
// This is an archived reproduction of the reviewed baseline, not a regression test.
const { execFileSync } = require('node:child_process');
const source = execFileSync('git', ['show', '2fe0864:worker/worker.js'], { cwd: path.join(__dirname, '../..'), encoding: 'utf8' });
const results = [];
const record = (id, details) => results.push({ id, ...details });
const sent = [];
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-14T02:00:00Z'])); }
  static now() { return new Date('2026-09-14T02:00:00Z').getTime(); }
}
const server = vm.createContext({
  URL, Request, Response, crypto: webcrypto, Date: FixedDate,
  setTimeout: fn => { fn(); return 0; },
  fetch: async (url, options) => {
    sent.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ ok: false, description: 'simulated Telegram failure' }), { status: 400 });
  }
});
vm.runInContext(source.replace('export default {', 'globalThis.worker = {'), server);
class MemoryKV {
  constructor(list = []) { this.values = new Map([['esim_list', JSON.stringify(list)], ['session_token_review', 'valid']]); }
  async get(key, options) {
    const value = this.values.get(key) ?? null;
    return options?.type === 'json' && value !== null ? JSON.parse(value) : value;
  }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
}
const envFor = kv => ({ ESIM_DB: kv, TG_BOT_TOKEN: 'local-test', TG_CHAT_ID: 'local-test' });
const req = (route, method = 'GET', body, extra = {}) => new Request('https://review.invalid' + route, {
  method, headers: { Authorization: 'Bearer review', 'Content-Type': 'application/json', ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const baseSim = { id: 'one', name: 'Example', number: '', expireDate: '2026-09-15', cycle: 30, cycleUnit: 'day' };

(async () => {
  const html = await (await server.worker.fetch(req('/'), envFor(new MemoryKV()))).text();
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim()).join('\n');
  new vm.Script(inline);
  record('E01', { workerAndInlineSyntax: 'pass', sourceSha256: createHash('sha256').update(source).digest('hex') });
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', innerText: '', textContent: '', disabled: false,
      classList: { add() {}, remove() {}, toggle() {} } });
    return elements.get(id);
  };
  const session = new Map();
  const front = vm.createContext({ Date: FixedDate, console, setTimeout: () => 0, clearTimeout() {},
    document: { getElementById: element, querySelector: () => element('query'), querySelectorAll: () => [] },
    window: {}, sessionStorage: { getItem: k => session.get(k), setItem: (k,v) => session.set(k,v), removeItem: k => session.delete(k) },
    fetch: async url => url === '/api/auth/verify' ? new Response(JSON.stringify({ success: true, token: 'local' })) : new Response('[]')
  });
  vm.runInContext(inline, front);
  vm.runInContext('esimData = ' + JSON.stringify([{ ...baseSim, name: '<b data-review="marker">Example</b>' }]) + '; openRenewModal("one")', front);
  assert(element('renewSimInfo').innerHTML.includes('<b data-review="marker">'));
  record('E02', { unescapedNameReachesRenewInnerHTML: element('renewSimInfo').innerHTML, browserExecutionTested: false });

  const invalidKV = new MemoryKV();
  const imported = await server.worker.fetch(req('/api/esims/import', 'POST', { mode: 'overwrite', data: [null] }), envFor(invalidKV));
  let importCronError;
  try { await server.worker.scheduled({}, envFor(invalidKV), {}); } catch(e) { importCronError = e.message; }
  assert.equal(imported.status, 200); assert(importCronError);
  record('E03', { nullImportStatus: imported.status, subsequentCronError: importCronError });

  const raceKV = new MemoryKV();
  let readCount = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const originalGet = raceKV.get.bind(raceKV);
  raceKV.get = async (key, options) => {
    const snapshot = await originalGet(key, options);
    if (key === 'esim_list') { if (++readCount === 2) release(); await gate; }
    return snapshot;
  };
  const writes = await Promise.all(['A', 'B'].map(name => server.worker.fetch(req('/api/esims', 'POST', { ...baseSim, name }), envFor(raceKV))));
  const finalList = await originalGet('esim_list', { type: 'json' });
  assert(writes.every(r => r.status === 200)); assert.equal(finalList.length, 1);
  record('E04', { concurrentCreateStatuses: writes.map(r => r.status), expectedRows: 2, actualRows: finalList.length });

  const dateResults = vm.runInContext(`[
    addCycleToDateUTC(new Date('2026-01-31T00:00:00Z'), 1, 'month').toISOString().slice(0,10),
    addCycleToDateUTC(new Date('2024-02-29T00:00:00Z'), 1, 'year').toISOString().slice(0,10)
  ]`, server);
  assert.equal(dateResults[0], '2026-03-03');
  record('E05', { jan31PlusMonth: dateResults[0], leapDayPlusYear: dateResults[1] });

  const notifyKV = new MemoryKV(Array.from({ length: 10 }, (_,i) => ({ ...baseSim, id: String(i), remark: '备'.repeat(500) })));
  sent.length = 0;
  await server.worker.scheduled({}, envFor(notifyKV), {});
  assert.equal(sent.length, 1); assert(sent[0].text.length > 4096);
  record('E06', { notificationCount: sent.length, messageCharacters: sent[0].text.length, mockHTTPStatus: 400, scheduledResolvedWithoutError: true });

  const otpKV = new MemoryKV();
  await otpKV.put('admin_auth_code', '123456');
  await otpKV.put('rate_limit_attempts_192.0.2.1', '5');
  const blocked = await server.worker.fetch(req('/api/auth/verify', 'POST', { code: '000000' }, { 'cf-connecting-ip': '192.0.2.1' }), envFor(otpKV));
  assert.equal(blocked.status, 403); assert.equal(await otpKV.get('admin_auth_code'), null);
  record('E07', { blockedIPStatus: blocked.status, globalCodeDeleted: true });

  vm.runInContext('renderCards(' + JSON.stringify([baseSim]) + ')', front);
  const stats = element('stats-container').innerHTML;
  vm.runInContext('renderCards([])', front);
  assert.equal(element('stats-container').innerHTML, stats);
  record('E08', { statsRetainedAfterEmptyList: true });

  element('authCode').value = '123456';
  await vm.runInContext('verifyCode()', front);
  vm.runInContext('logout()', front);
  assert.equal(element('loginBtn').disabled, true);
  record('E09', { loginButtonDisabledAfterSuccessfulLoginAndLogout: true });

  const sortResult = vm.runInContext('currentSort = { key: "addTime", asc: true }; sortEsims(' + JSON.stringify([
    { id: 'f0000000-0000-4000-8000-000000000000', name: 'older' },
    { id: '10000000-0000-4000-8000-000000000000', name: 'newer' }
  ]) + ').map(s => s.name)', front);
  assert.equal(sortResult[0], 'newer');
  record('E10', { addTimeAscendingWithUUID: Array.from(sortResult) });
  const cors = await server.worker.fetch(req('/api/esims', 'GET', undefined, { Origin: 'https://workers.dev.attacker.invalid' }), envFor(new MemoryKV()));
  assert.equal(cors.headers.get('Access-Control-Allow-Origin'), 'https://workers.dev.attacker.invalid');
  record('E11', { reflectedUntrustedOrigin: cors.headers.get('Access-Control-Allow-Origin'), bearerTokenStillRequired: true });
  console.log(JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
