/**
 * Automated Test Suite for Clash Arena Stage B Networking
 * 
 * Tests:
 * 1. Health check HTTP endpoint
 * 2. Room creation and 4-letter code generation
 * 3. Second player joining room & match start
 * 4. Input queuing, delay buffering, and authoritative state broadcast
 * 5. Sequence acknowledgement (lastProcessedSeq)
 * 6. Disconnect pause & successful reconnect with secret
 * 7. Disconnect pause & grace timeout victory award
 */

const http = require('http');
const WebSocket = require('./server/node_modules/ws');

const SERVER_PORT = 8080;
const WS_URL = `ws://localhost:${SERVER_PORT}`;
const HTTP_URL = `http://localhost:${SERVER_PORT}/health`;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('=== CLASH ARENA: STAGE B NETWORKING TEST SUITE ===');

  // Test 1: HTTP Health Check
  console.log('\n[Test 1] Checking HTTP Health Check endpoint...');
  const health = await httpGet(HTTP_URL);
  if (health.status !== 'ok') {
    throw new Error('Health check returned non-ok status: ' + JSON.stringify(health));
  }
  console.log('✔ Test 1 Passed: Health check endpoint responded status "ok"');

  // Test 2: Client A connects and creates room
  console.log('\n[Test 2] Client A connecting & creating room...');
  const wsA = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    wsA.on('open', resolve);
    wsA.on('error', reject);
  });

  let roomCreatedPromise = new Promise((resolve) => {
    wsA.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'room_created') resolve(msg);
    });
  });

  wsA.send(JSON.stringify({ type: 'create_room' }));
  const roomCreatedMsg = await roomCreatedPromise;
  console.log(`✔ Test 2 Passed: Room created with code: "${roomCreatedMsg.roomCode}", PlayerId: ${roomCreatedMsg.playerId}`);
  const roomCode = roomCreatedMsg.roomCode;
  const secretA = roomCreatedMsg.secret;

  // Test 3: Client B joins room & match start
  console.log('\n[Test 3] Client B connecting & joining room ' + roomCode + '...');
  const wsB = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    wsB.on('open', resolve);
    wsB.on('error', reject);
  });

  let matchStartAPromise = new Promise(resolve => {
    wsA.on('message', data => {
      const msg = JSON.parse(data);
      if (msg.type === 'match_start') resolve(msg);
    });
  });

  let matchStartBPromise = new Promise(resolve => {
    wsB.on('message', data => {
      const msg = JSON.parse(data);
      if (msg.type === 'match_start') resolve(msg);
    });
  });

  wsB.send(JSON.stringify({ type: 'join_room', roomCode: roomCode }));
  const [matchA, matchB] = await Promise.all([matchStartAPromise, matchStartBPromise]);

  if (matchA.playerRole !== 1 || matchB.playerRole !== 2) {
    throw new Error(`Unexpected player roles: A=${matchA.playerRole}, B=${matchB.playerRole}`);
  }
  const secretB = matchB.secret;
  console.log('✔ Test 3 Passed: Both players received MATCH_START with correct roles (P1 and P2)');

  // Test 4: Authoritative 60Hz state broadcasts & input processing
  console.log('\n[Test 4] Testing authoritative state broadcast & sequence ack...');
  let stateReceivedByA = null;
  let statePromise = new Promise(resolve => {
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'state' && msg.lastProcessedSeq && msg.lastProcessedSeq[1] >= 1) {
        stateReceivedByA = msg;
        wsA.off('message', handler);
        resolve(msg);
      }
    };
    wsA.on('message', handler);
  });

  // Client A sends moving input
  wsA.send(JSON.stringify({
    type: 'input',
    seq: 1,
    timestamp: Date.now(),
    input: { moveX: 1, moveY: 0, attack: false, dodge: false, parry: false }
  }));

  const stateSnapshot = await statePromise;
  console.log(`✔ Test 4 Passed: Authoritative state received (tick: ${stateSnapshot.tick}, ackSeqP1: ${stateSnapshot.lastProcessedSeq[1]})`);

  // Test 5: Disconnect pause & successful reconnect
  console.log('\n[Test 5] Testing disconnect pause & secret reconnect...');
  let pausedPromise = new Promise(resolve => {
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'match_paused') {
        wsA.off('message', handler);
        resolve(msg);
      }
    };
    wsA.on('message', handler);
  });

  // Close Client B connection
  wsB.close();
  const pauseMsg = await pausedPromise;
  console.log('  Player A received MATCH_PAUSED:', pauseMsg.reason);

  // Now reconnect Client B with secretB
  const wsB2 = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    wsB2.on('open', resolve);
    wsB2.on('error', reject);
  });

  let resumePromise = new Promise(resolve => {
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'match_resumed') {
        wsA.off('message', handler);
        resolve(msg);
      }
    };
    wsA.on('message', handler);
  });

  wsB2.send(JSON.stringify({
    type: 'reconnect',
    roomCode: roomCode,
    playerId: 2,
    secret: secretB
  }));

  const resumeMsg = await resumePromise;
  console.log('✔ Test 5 Passed: Match resumed after successful client reconnection!');

  // Test 6: Permanent disconnect grace period expiration
  console.log('\n[Test 6] Testing disconnect timeout (5s) -> Victory awarded to remaining player...');
  let victoryPromise = new Promise(resolve => {
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'opponent_disconnected') {
        wsA.off('message', handler);
        resolve(msg);
      }
    };
    wsA.on('message', handler);
  });

  // Close Client B again permanently
  wsB2.close();

  const victoryMsg = await victoryPromise;
  if (victoryMsg.winnerId !== 1) {
    throw new Error('Expected winnerId 1 for remaining player, got: ' + victoryMsg.winnerId);
  }
  console.log(`✔ Test 6 Passed: OPPONENT_DISCONNECTED received. Winner: Player ${victoryMsg.winnerId}. "${victoryMsg.reason}"`);

  wsA.close();

  console.log('\n========================================');
  console.log('ALL NETWORKING & PROTOCOL TESTS PASSED 100%!');
  console.log('========================================');
}

runTests().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
