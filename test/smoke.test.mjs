import test from 'node:test';
import assert from 'node:assert';
import { LiveKitServer, roomTimeouts, extractManagedStorageKey } from '../dist/server/index.js';

test('token + grants', async () => {
  const lk = new LiveKitServer({ apiKey: 'devkey', apiSecret: 'devsecret-devsecret-devsecret-0000', url: 'wss://example.invalid', logger: { log() {}, warn() {}, error() {} } });
  const jwt = await lk.createToken({ roomName: 'r1', role: 'guest', id: 'g1' });
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  assert.equal(payload.sub, 'guest_g1');
  assert.equal(payload.video.canPublish, false);
  assert.equal(lk.grantFor('host', 'r').roomAdmin, true);
  assert.deepEqual(roomTimeouts(0), { departureTimeout: 180, emptyTimeout: 600 });
  assert.equal(extractManagedStorageKey('s3://b/a/x.mp4', 'b'), 'a/x.mp4');
});
