import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHOP_AGENT_PREFIX } from '../../src/modules/files/downloads.controller.js';
import { StorageService } from '../../src/modules/files/storage.service.js';
import { type Harness, createHarness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe('shop app downloads', () => {
  it('streams an uploaded file from the API itself (no storage redirect)', async () => {
    const storage = h.app.get(StorageService);
    await storage.put(
      `${SHOP_AGENT_PREFIX}releases.win.json`,
      Buffer.from('{"a":1}'),
      'application/json',
    );
    await storage.put(
      `${SHOP_AGENT_PREFIX}KagazShop-win-Setup.exe`,
      Buffer.from('MZ'),
      'application/octet-stream',
    );

    const feed = await h
      .http()
      .get('/api/downloads/shop-agent/releases.win.json?arch=x64')
      .expect(200);
    expect(feed.headers['content-type']).toContain('application/json');
    expect(feed.body).toEqual({ a: 1 });

    const exe = await h.http().get('/api/downloads/shop-agent/KagazShop-win-Setup.exe').expect(200);
    expect(exe.headers['content-disposition']).toBe(
      'attachment; filename="KagazShop-win-Setup.exe"',
    );
    expect(exe.headers['content-length']).toBe('2');
  });

  it('404s for files that are not uploaded or not allow-listed', async () => {
    await h.http().get('/api/downloads/shop-agent/KagazShop-9.9.9-full.nupkg').expect(404);
    await h.http().get('/api/downloads/shop-agent/..%2F..%2Fsecret.pdf').expect(404);
    await h.http().get('/api/downloads/shop-agent/orders.pdf').expect(404);
  });
});
