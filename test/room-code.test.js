const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createRoomStore } = require('../src/server/room-store');

describe('room-store', () => {
  it('creates unique room codes', () => {
    const store = createRoomStore();
    const a = store.createRoomCode('tennis');
    const b = store.createRoomCode('tennis');
    assert.notEqual(a, b);
    assert.match(a, /^[A-Z0-9]{4}$/);
  });

  it('isolates rooms by game id', () => {
    const store = createRoomStore();
    store.getOrCreateRoom('tennis', 'ABCD');
    store.getOrCreateRoom('pingpong', 'ABCD');
    assert.ok(store.getRoom('tennis', 'ABCD'));
    assert.ok(store.getRoom('pingpong', 'ABCD'));
    assert.equal(store.rooms.size, 2);
  });

  it('sanitizes player names', () => {
    const store = createRoomStore();
    assert.equal(store.sanitizeName('  Alice  ', 'P1'), 'Alice');
    assert.equal(store.sanitizeName('', 'P2'), 'P2');
  });

  it('snapshots controller readiness', () => {
    const store = createRoomStore();
    const room = store.getOrCreateRoom('tennis', 'WXYZ');
    room.controllers.set(1, 'sock1');
    room.ready.set(1, true);
    room.names.set(1, 'Bob');
    const snap = store.roomSnapshot(room);
    assert.equal(snap.p1, true);
    assert.equal(snap.ready1, true);
    assert.equal(snap.name1, 'Bob');
  });
});
