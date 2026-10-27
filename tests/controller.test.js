const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvo-controller-test-'));
process.env.BB_DIR = dir;
delete process.env.BB_REMOTE;
delete process.env.RENDER;
const BB = require('../agent-runtime/room/blackboard');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function stub(relative, exports) {
  const id = require.resolve(relative);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

test('the real controller dispatches specialist roles and pauses for the client', async () => {
  const calls = [];
  stub('../agent-runtime/room/bb_overseer', {
    overseerTurn: async film => {
      const judgment = BB.emit(film, 'overseer', 'moves', 'film', null, 'test plan', 'judgment');
      return { judgmentEventId: judgment.id, moves: [
        { act: 'run_director' }, { act: 'run_critic', phase: 'concept' },
        { act: 'ask_client', question: 'Approve the concept?' }
      ] };
    }
  });
  stub('../agent-runtime/room/bb_director', {
    directorOntoBoard: async film => { calls.push('director'); BB.setFilmPlan(film, { storyboardCount: 1 }); },
    directorAdjudicate: async () => ({})
  });
  stub('../agent-runtime/room/bb_cine', { cineOntoBoard: async () => {}, reworkBoard: async () => {} });
  stub('../agent-runtime/room/bb_critic', {
    criticOntoBoard: async (_film, opts) => { calls.push('critic:' + opts.phase); }, criticRebut: async () => {}
  });
  stub('../agent-runtime/understanding/routes', { runUnderstandingPipeline: async () => ({}) });
  stub('../agent-runtime/understanding/proxy', { dbRead: async () => null, dbWrite: async () => null });
  const { runFilm } = require('../agent-runtime/room/bb_controller');
  const film = BB.newFilm({ filmId: 'film-controller' });
  const result = await runFilm(film);
  assert.deepEqual(calls, ['director', 'critic:concept']);
  assert.equal(result.status, 'awaiting_client');
  assert.equal(result.question, 'Approve the concept?');
  const dispatches = film.events.filter(e => e.actor === 'controller' && e.action === 'dispatch');
  assert.deepEqual(dispatches.map(e => e.payload.act), ['run_director', 'run_critic', 'ask_client']);
  assert.ok(dispatches.every(e => e.warrant));
});
