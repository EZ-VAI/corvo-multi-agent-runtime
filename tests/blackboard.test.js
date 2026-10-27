const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvo-blackboard-test-'));
process.env.BB_DIR = dir;
delete process.env.BB_REMOTE;
const BB = require('../agent-runtime/room/blackboard');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('delivery requires a proposal followed by explicit client approval', () => {
  const film = BB.newFilm({ filmId: 'film-gates' });
  assert.throws(() => BB.clientApprove(film, 'yes'), /proposal/i);
  assert.throws(() => BB.ship(film), /propose_ship/i);
  const proposal = BB.proposeShip(film, 'ready', 'overseer');
  assert.throws(() => BB.ship(film), /client approval/i);
  const approval = BB.clientApprove(film, 'approved');
  const shipped = BB.ship(film, 'done');
  assert.equal(film.status, 'shipped');
  assert.equal(approval.warrant, proposal.id);
  assert.equal(shipped.warrant, approval.id);
});

test('critique authority and review state survive local persistence', () => {
  const film = BB.newFilm({ filmId: 'film-critique' });
  const board = BB.addBoard(film, { id: 'b1' });
  const critique = BB.addCritique(film, board.id, { note: 'Check product fidelity', severity: 'major' });
  assert.equal(BB.boardState(board), 'in_review');
  assert.throws(() => BB.resolveCritique(film, board.id, critique.id, 'director'), /only critic/i);
  BB.resolveCritique(film, board.id, critique.id, 'critic');
  BB.save(film);
  const restored = BB.load('film-critique');
  assert.equal(restored.boards[0].critique[0].status, 'resolved');
  assert.ok(restored.events.some(e => e.action === 'resolve_critique' && e.actor === 'critic'));
});

test('render failures and client instructions remain visible in the board', () => {
  const film = BB.newFilm({ filmId: 'film-feedback' });
  const board = BB.addBoard(film, { id: 'b2' });
  BB.recordRenderFact(film, board.id, { status: 'qc_blocked' });
  assert.equal(BB.boardState(board), 'in_review');
  const feedback = BB.clientDirection(film, { agent: 'cinematographer', boardId: 'b2', panel: 3, note: 'Change framing' });
  assert.equal(feedback.payload.agent, 'cinematographer');
  assert.equal(feedback.payload.panel, 3);
  assert.equal(feedback.target, 'b2');
});
