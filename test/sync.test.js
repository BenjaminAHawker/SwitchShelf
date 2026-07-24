const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempDir } = require('./helpers');

process.env.DATA_DIR = tempDir('stl-data-');

const sync = require('../lib/sync');

const REMOTE_FILES = [
  { name: 'US.en.json', sha: 'sha-us-en-v1', size: 100 },
  { name: 'JP.ja.json', sha: 'sha-jp-ja-v1', size: 200 },
  { name: 'cnmts.json', sha: 'sha-cnmts-v1', size: 300 },
  { name: 'README.md', sha: 'sha-readme', size: 10 }, // not a region or extra file
];

let fetchImpl = null;
global.fetch = (...args) => fetchImpl(...args);

function mockGithubOk() {
  fetchImpl = async (url) => {
    if (url === 'https://api.github.com/repos/blawar/titledb/contents') {
      return new Response(JSON.stringify(REMOTE_FILES.map((f) => ({ ...f, type: 'file' }))), { status: 200 });
    }
    if (url.startsWith('https://raw.githubusercontent.com/blawar/titledb/master/')) {
      const name = url.split('/').pop();
      return new Response(`contents of ${name}`, { status: 200 });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  };
}

test('listRemoteRegionFiles filters to region files, sorted by name', async () => {
  mockGithubOk();
  const files = await sync.listRemoteRegionFiles();
  assert.deepEqual(files.map((f) => f.name), ['JP.ja.json', 'US.en.json']);
});

test('getRegionsStatus reports nothing downloaded initially', async () => {
  mockGithubOk();
  const { source, regions } = await sync.getRegionsStatus();
  assert.equal(source, 'remote');
  const us = regions.find((s) => s.name === 'US.en.json');
  assert.equal(us.downloaded, false);
  assert.equal(us.stale, false);
  assert.equal(us.region, 'US');
  assert.equal(us.language, 'en');
});

test('syncFile downloads a missing file and records it in meta', async () => {
  mockGithubOk();
  const result = await sync.syncFile('US.en.json');
  assert.equal(result.updated, true);
  assert.equal(result.sha, 'sha-us-en-v1');

  const written = fs.readFileSync(path.join(sync.DATA_DIR, 'US.en.json'), 'utf8');
  assert.equal(written, 'contents of US.en.json');
});

test('getRegionsStatus now reports that file as downloaded and not stale', async () => {
  mockGithubOk();
  const { regions } = await sync.getRegionsStatus();
  const us = regions.find((s) => s.name === 'US.en.json');
  assert.equal(us.downloaded, true);
  assert.equal(us.stale, false);
  assert.equal(us.source, 'sync');
});

test('syncFile is a no-op (updated:false) when the sha already matches', async () => {
  mockGithubOk();
  let downloadCalled = false;
  const original = fetchImpl;
  fetchImpl = async (url, opts) => {
    if (url.startsWith('https://raw.githubusercontent.com')) downloadCalled = true;
    return original(url, opts);
  };
  const result = await sync.syncFile('US.en.json');
  assert.equal(result.updated, false);
  assert.equal(downloadCalled, false);
});

test('syncFile reports stale/updated when the upstream sha changes', async () => {
  fetchImpl = async (url) => {
    if (url === 'https://api.github.com/repos/blawar/titledb/contents') {
      const updated = REMOTE_FILES.map((f) => (f.name === 'US.en.json' ? { ...f, sha: 'sha-us-en-v2', type: 'file' } : { ...f, type: 'file' }));
      return new Response(JSON.stringify(updated), { status: 200 });
    }
    return new Response('new contents', { status: 200 });
  };

  const { regions } = await sync.getRegionsStatus();
  const us = regions.find((s) => s.name === 'US.en.json');
  assert.equal(us.stale, true);

  const result = await sync.syncFile('US.en.json');
  assert.equal(result.updated, true);
  assert.equal(result.sha, 'sha-us-en-v2');
});

test('syncFile rejects a name that is not a known region or extra file', async () => {
  mockGithubOk();
  await assert.rejects(() => sync.syncFile('README.md'), /Unsupported file name/);
});

test('syncFile rejects a plausibly-named file the remote does not actually have', async () => {
  fetchImpl = async (url) => {
    if (url === 'https://api.github.com/repos/blawar/titledb/contents') {
      return new Response(JSON.stringify([{ name: 'US.en.json', sha: 'x', size: 1, type: 'file' }]), { status: 200 });
    }
    throw new Error('should not download');
  };
  await assert.rejects(() => sync.syncFile('FR.fr.json'), /Unknown file/);
});

test('listRemoteRegionFiles surfaces a GitHub API error', async () => {
  fetchImpl = async () => new Response('rate limited', { status: 403 });
  await assert.rejects(() => sync.listRemoteRegionFiles(), /GitHub API error 403/);
});

// Regression coverage for the "blawar/titledb goes away" scenario: the app
// should degrade to a bundled region list instead of the whole page breaking.
test('getRegionsStatus falls back to the bundled region list when GitHub is unreachable, and still reflects local sync state', async () => {
  mockGithubOk();
  await sync.syncFile('US.en.json'); // downloaded while GitHub is still reachable

  fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  const { source, regions } = await sync.getRegionsStatus();
  assert.equal(source, 'fallback');
  assert.ok(regions.length > 50); // the bundled snapshot, not an empty list
  const us = regions.find((r) => r.name === 'US.en.json');
  assert.equal(us.downloaded, true);
  assert.equal(us.stale, false); // no sha to compare against while offline — never guessed
  const unsynced = regions.find((r) => r.name === 'FR.fr.json');
  assert.equal(unsynced.downloaded, false);
});

test('getExtrasStatus falls back to a bundled cnmts.json entry when GitHub is unreachable', async () => {
  fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  const { source, extras } = await sync.getExtrasStatus();
  assert.equal(source, 'fallback');
  assert.deepEqual(extras.map((e) => e.name), ['cnmts.json']);
});

test('applyUpload rejects a name outside the region/extra pattern', () => {
  const tmp = path.join(sync.DATA_DIR, 'upload-tmp-1.json');
  fs.writeFileSync(tmp, '{}');
  assert.throws(() => sync.applyUpload('../escape.json', tmp), /Unsupported file name/);
  fs.unlinkSync(tmp);
});

test('applyUpload rejects a file that is not valid JSON, without touching any existing data', () => {
  const tmp = path.join(sync.DATA_DIR, 'upload-tmp-2.json');
  fs.writeFileSync(tmp, 'not json');
  assert.throws(() => sync.applyUpload('ZZ.en.json', tmp), /not valid JSON/);
  assert.equal(fs.existsSync(path.join(sync.DATA_DIR, 'ZZ.en.json')), false);
});

test('applyUpload files a valid manually-provided region file and records it with source "upload"', async () => {
  const tmp = path.join(sync.DATA_DIR, 'upload-tmp-3.json');
  fs.writeFileSync(tmp, JSON.stringify({ 1: { id: '0100000000099999', name: 'Manually Added Game' } }));
  sync.applyUpload('ZZ.en.json', tmp);

  assert.equal(fs.existsSync(tmp), false); // moved, not copied-and-left-behind
  const written = JSON.parse(fs.readFileSync(path.join(sync.DATA_DIR, 'ZZ.en.json'), 'utf8'));
  assert.equal(written['1'].name, 'Manually Added Game');

  fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  const { regions } = await sync.getRegionsStatus();
  const zz = regions.find((r) => r.name === 'ZZ.en.json');
  // ZZ isn't a real titledb region, so it only shows up because it's locally
  // present — getRegionsStatus folds in anything meta.json knows about that
  // the bundled list doesn't, so an upload is never invisible.
  assert.ok(zz, 'an uploaded file not in the bundled list should still be reported');
  assert.equal(zz.downloaded, true);
  assert.equal(zz.source, 'upload');
});
