// MediaPipe visibility measures visibility/occlusion, not just frame position:
// https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md
const MIN_VISIBILITY = 0.5;
const EDGE_MARGIN = 0.04;
const HEAD_MARGIN = 0.07;
const HEAD_INDICES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const BODY_GROUPS = [
  { name: 'Head', indices: [0, 2, 5, 7, 8], minimum: 1 },
  { name: 'Torso', indices: [11, 12, 23, 24], minimum: 3 },
  { name: 'Left hand', indices: [15, 17, 19, 21], minimum: 1 },
  { name: 'Right hand', indices: [16, 18, 20, 22], minimum: 1 },
  { name: 'Left foot', indices: [27, 29, 31], minimum: 1 },
  { name: 'Right foot', indices: [28, 30, 32], minimum: 1 },
];

export const CHECKING_FRAMING = {
  status: 'checking',
  label: 'Checking framing',
  message: 'Keep your head, hands and feet visible.',
};

export const WAITING_FOR_FRAMES = {
  status: 'waiting',
  label: 'Waiting for video',
  message: 'Framing will update when video resumes.',
};

function isVisible(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    Number.isFinite(point.visibility) && point.visibility >= MIN_VISIBILITY;
}

function edgeAdvice(edges) {
  if (edges.size > 1) return 'Step back so your whole body fits in the picture.';
  if (edges.has('top')) return 'Step back or adjust the camera to leave room above your head.';
  if (edges.has('bottom')) return 'Step back or tilt the camera down to include both feet.';
  // The preview is mirrored; avoid ambiguous left/right directions.
  return 'Move toward the center and leave room for your swing.';
}

export function assessBodyFraming(landmarks = []) {
  if (!landmarks.length) {
    return { status: 'no-body', label: 'No body detected', message: 'Stand in front of the camera with your full body visible.' };
  }

  const outside = new Set();
  const nearEdge = new Set();
  landmarks.forEach((point, index) => {
    // Uncertain inferred coordinates cannot prove that a body part is cropped.
    if (!isVisible(point)) return;
    if (point.x < 0 || point.x > 1) outside.add('side');
    if (point.y < 0) outside.add('top');
    if (point.y > 1) outside.add('bottom');
    if (point.x <= EDGE_MARGIN || point.x >= 1 - EDGE_MARGIN) nearEdge.add('side');
    if (point.y <= (HEAD_INDICES.has(index) ? HEAD_MARGIN : EDGE_MARGIN)) nearEdge.add('top');
    if (point.y >= 1 - EDGE_MARGIN) nearEdge.add('bottom');
  });

  if (outside.size) {
    return { status: 'out-of-frame', label: 'Body out of frame', message: edgeAdvice(outside) };
  }

  const missing = BODY_GROUPS.filter((group) =>
    group.indices.filter((index) => isVisible(landmarks[index])).length < group.minimum
  );
  if (missing.length) {
    const parts = missing.map((group) => group.name.toLowerCase()).join(', ');
    return {
      status: 'uncertain',
      label: 'Full body not confirmed',
      message: `Not clearly visible: ${parts}. Step back, remove obstructions or improve lighting.`,
    };
  }

  if (nearEdge.size) {
    return { status: 'near-edge', label: 'Too close to the edge', message: edgeAdvice(nearEdge) };
  }

  return { status: 'ready', label: 'Full body in frame', message: 'Keep some space around you for your swing.' };
}

// Use elapsed time rather than frame counts, since inference FPS varies by laptop.
export function createFramingMonitor() {
  let current = CHECKING_FRAMING;
  let candidateKey = '';
  let candidateSince = 0;
  let lastTimestamp = null;
  let lastReport = -Infinity;
  return (landmarks, timestamp) => {
    if (lastTimestamp !== null && (timestamp - lastTimestamp > 1500 || timestamp < lastTimestamp)) {
      current = CHECKING_FRAMING;
      candidateKey = '';
      lastReport = -Infinity;
    }
    lastTimestamp = timestamp;
    const next = assessBodyFraming(landmarks);
    // Changing which limb is missing must not leave a stale green status active.
    const key = next.status === 'ready' ? 'ready' : 'warning';
    if (key !== candidateKey) {
      candidateKey = key;
      candidateSince = timestamp;
    }
    const delay = next.status === 'ready' ? 700 : 350;
    if (timestamp - candidateSince >= delay && timestamp - lastReport >= 350 &&
        (current.status !== next.status || current.message !== next.message)) {
      current = next;
      lastReport = timestamp;
    }
    return current;
  };
}
