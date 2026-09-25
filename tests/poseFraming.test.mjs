import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBodyFraming, createFramingMonitor } from '../src/poseFraming.js';

function fullBody() {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.18, visibility: 0.99 }));
  for (let i = 11; i <= 22; i++) points[i] = { x: i % 2 ? 0.3 : 0.7, y: 0.45, visibility: 0.99 };
  for (let i = 23; i <= 26; i++) points[i] = { x: i % 2 ? 0.4 : 0.6, y: 0.65, visibility: 0.99 };
  for (let i = 27; i <= 32; i++) points[i] = { x: i % 2 ? 0.4 : 0.6, y: 0.9, visibility: 0.99 };
  return points;
}

test('fully visible body with clearance is ready', () => {
  assert.equal(assessBodyFraming(fullBody()).status, 'ready');
});

test('no detections and an incomplete detection do not report ready', () => {
  assert.equal(assessBodyFraming([]).status, 'no-body');
  assert.equal(assessBodyFraming().status, 'no-body');
  assert.equal(assessBodyFraming(fullBody().slice(0, 25)).status, 'uncertain');
});

test('foot beyond the bottom gives a camera placement prompt', () => {
  const points = fullBody();
  points[31].y = 1.1;
  const result = assessBodyFraming(points);
  assert.equal(result.status, 'out-of-frame');
  assert.match(result.message, /feet/);
});

test('hand outside either side asks to center without reversed mirror directions', () => {
  for (const x of [-0.1, 1.1]) {
    const points = fullBody();
    points[15].x = x;
    const result = assessBodyFraming(points);
    assert.equal(result.status, 'out-of-frame');
    assert.match(result.message, /center/);
    assert.doesNotMatch(result.message, /left|right/);
  }
});

test('head above the frame and a body crossing multiple edges get appropriate prompts', () => {
  const points = fullBody();
  points[0].y = -0.02;
  assert.match(assessBodyFraming(points).message, /head/);
  points[31].y = 1.1;
  assert.match(assessBodyFraming(points).message, /whole body/);
});

test('warns before the body leaves the frame, including head clearance', () => {
  for (const [index, coordinate, value] of [[15, 'x', 0.04], [16, 'x', 0.96], [31, 'y', 0.97], [0, 'y', 0.06]]) {
    const points = fullBody();
    points[index][coordinate] = value;
    assert.equal(assessBodyFraming(points).status, 'near-edge');
  }
});

test('exact image boundaries are near-edge, not safely framed', () => {
  for (const y of [0, 1]) {
    const points = fullBody();
    points[31].y = y;
    assert.equal(assessBodyFraming(points).status, 'near-edge');
  }
});

test('occluded, inferred feet are uncertain even when their estimated position is outside', () => {
  const points = fullBody();
  for (let i = 27; i <= 32; i++) { points[i].visibility = 0.1; points[i].y = 1.3; }
  const result = assessBodyFraming(points);
  assert.equal(result.status, 'uncertain');
  assert.match(result.message, /left foot, right foot/);
});

test('both hands and both feet must have independent evidence', () => {
  for (const group of [[15, 17, 19, 21], [16, 18, 20, 22], [27, 29, 31], [28, 30, 32]]) {
    const points = fullBody();
    group.forEach((index) => { points[index].visibility = 0; });
    assert.equal(assessBodyFraming(points).status, 'uncertain');
  }
});

test('individual occluded facial and foot landmarks do not require every landmark to be visible', () => {
  const points = fullBody();
  [2, 5, 7, 8, 27, 28, 29, 30].forEach((index) => { points[index].visibility = 0.1; });
  assert.equal(assessBodyFraming(points).status, 'ready');
});

test('invalid coordinates and absent confidence cannot produce a ready status', () => {
  for (const badValue of [NaN, Infinity, undefined]) {
    const points = fullBody();
    [15, 17, 19, 21].forEach((index) => { points[index].x = badValue; });
    assert.equal(assessBodyFraming(points).status, 'uncertain');
  }
  assert.equal(assessBodyFraming(fullBody().map(({ x, y }) => ({ x, y }))).status, 'uncertain');
});

test('a brief dropout does not flicker, but sustained loss and recovery change status', () => {
  const check = createFramingMonitor();
  assert.equal(check(fullBody(), 0).status, 'checking');
  const ready = check(fullBody(), 700);
  assert.equal(ready.status, 'ready');
  assert.equal(check([], 800), ready);
  assert.equal(check(fullBody(), 1000), ready);
  assert.equal(check([], 1800), ready);
  assert.equal(check([], 2149), ready);
  assert.equal(check([], 2150).status, 'no-body');
  assert.equal(check(fullBody(), 2200).status, 'no-body');
  assert.equal(check(fullBody(), 2899).status, 'no-body');
  assert.equal(check(fullBody(), 2900).status, 'ready');
});

test('changing warning types still flags sustained bad framing', () => {
  const check = createFramingMonitor();
  check(fullBody(), 0);
  check(fullBody(), 700);
  const cropped = fullBody();
  cropped[31].y = 1.1;
  const obscured = fullBody().slice(0, 25);
  check(cropped, 800);
  check(obscured, 1000);
  assert.notEqual(check([], 1150).status, 'ready');
});

test('a long video gap or a restarted clock invalidates prior framing', () => {
  const check = createFramingMonitor();
  check(fullBody(), 0);
  assert.equal(check(fullBody(), 700).status, 'ready');
  assert.equal(check(fullBody(), 3000).status, 'checking');
  assert.equal(check(fullBody(), 3700).status, 'ready');
  assert.equal(check(fullBody(), 0).status, 'checking');
});
