import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, parseJsonObject } from '../src/config.js';

test('parseJsonObject tolerates junk and arrays', () => {
  assert.deepEqual(parseJsonObject(''), {});
  assert.deepEqual(parseJsonObject('not json'), {});
  assert.deepEqual(parseJsonObject('[1,2]'), {});
  assert.deepEqual(parseJsonObject('{"a":"b"}'), { a: 'b' });
});

test('missing credentials are reported, not thrown', () => {
  const { config, missing } = loadConfig({}, []);
  assert.deepEqual(missing, ['SEAART_COOKIE', 'SEAART_USER_AGENT']);
  assert.deepEqual(config.cookies, []);
});

test('defaults match the two required surfaces', () => {
  const { config } = loadConfig(
    { SEAART_COOKIE: 'a=1', SEAART_USER_AGENT: 'UA/1.0' },
    []
  );
  assert.equal(config.urls.checkin, 'https://www.seaart.ai/zhTW/battlePass');
  assert.equal(
    config.urls.gift,
    'https://www.seaart.ai/zhTW/mall?dotFrom=svip_banner'
  );
  assert.equal(config.locale, 'zhTW');
  assert.equal(config.headless, true);
  assert.equal(config.dryRun, false);
  assert.equal(config.cookies.length, 1);
});

test('CLI flags override environment', () => {
  const { config } = loadConfig(
    { SEAART_COOKIE: 'a=1', SEAART_USER_AGENT: 'UA/1.0' },
    ['--headed', '--dry-run', '--dump']
  );
  assert.equal(config.headless, false);
  assert.equal(config.dryRun, true);
  assert.equal(config.dump, true);
});

test('numeric and boolean env parsing is defensive', () => {
  const { config } = loadConfig(
    {
      SEAART_COOKIE: 'a=1',
      SEAART_USER_AGENT: 'UA/1.0',
      SEAART_TIMEOUT_MS: 'not-a-number',
      SEAART_HEADLESS: 'off'
    },
    []
  );
  assert.equal(config.timeoutMs, 45_000);
  assert.equal(config.headless, false);
});
