import { useEffect, useRef, useState } from 'react';

const MEDIAPIPE_WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';
const MEDIAPIPE_MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [27, 29], [29, 31], [24, 26], [26, 28], [28, 30], [30, 32],
];

const shotBlueprints = [
  { x: -62, y: 34, clubSpeed: 103.4, faceAngle: -2.8, confidence: 94 },
  { x: 24, y: -20, clubSpeed: 105.1, faceAngle: 0.8, confidence: 97 },
  { x: 54, y: 30, clubSpeed: 101.6, faceAngle: 3.1, confidence: 89 },
  { x: -22, y: -34, clubSpeed: 106.8, faceAngle: -1.2, confidence: 96 },
  { x: 12, y: 10, clubSpeed: 107.5, faceAngle: 0.2, confidence: 98 },
  { x: -38, y: 18, clubSpeed: 102.3, faceAngle: -2.1, confidence: 92 },
  { x: 60, y: -36, clubSpeed: 100.2, faceAngle: 3.5, confidence: 86 },
  { x: -8, y: 6, clubSpeed: 108.1, faceAngle: -0.1, confidence: 99 },
  { x: 36, y: -42, clubSpeed: 99.6, faceAngle: 2.4, confidence: 85 },
  { x: -56, y: -18, clubSpeed: 104.9, faceAngle: -2.9, confidence: 91 },
  { x: 10, y: 26, clubSpeed: 109.4, faceAngle: 0.5, confidence: 96 },
  { x: -30, y: 40, clubSpeed: 101.1, faceAngle: -1.7, confidence: 88 },
  { x: 68, y: 8, clubSpeed: 98.8, faceAngle: 3.7, confidence: 84 },
  { x: -70, y: -6, clubSpeed: 103.7, faceAngle: -3.2, confidence: 87 },
  { x: 6, y: -48, clubSpeed: 107.2, faceAngle: 0.4, confidence: 95 },
  { x: -12, y: 52, clubSpeed: 100.7, faceAngle: -0.8, confidence: 90 },
];

const createShot = (blueprint, index) => {
  const distance = Math.hypot(blueprint.x, blueprint.y);
  const centered = distance <= 18;
  const intensity = Math.min(distance / 42, 1);
  const side = blueprint.x >= 0 ? 'Toe side' : 'Heel side';
  const bias =
    blueprint.faceAngle > 0.9
      ? 'Fade bias'
      : blueprint.faceAngle < -0.9
        ? 'Draw bias'
        : 'Neutral flight';
  const score = Math.max(72, Math.round(100 - distance * 0.5 - Math.abs(blueprint.faceAngle) * 7));

  return {
    id: `shot-${index + 1}`,
    index: index + 1,
    ...blueprint,
    distance,
    centered,
    intensity,
    side,
    bias,
    score,
    timestamp: `${9 + Math.floor(index / 3)}:${(12 + index * 4).toString().padStart(2, '0')}`,
  };
};

function App() {
  const [shots, setShots] = useState([]);
  const [nextBlueprintIndex, setNextBlueprintIndex] = useState(0);
  const [showLogo, setShowLogo] = useState(true);
  const [showShotMenu, setShowShotMenu] = useState(false);
  const [poseStatus, setPoseStatus] = useState('Loading pose model...');
  const [poseModelReady, setPoseModelReady] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [poseCount, setPoseCount] = useState(0);
  const [videoError, setVideoError] = useState('');
  const [videoMetrics, setVideoMetrics] = useState({
    fps: 0,
    hipDrift: 0,
    shoulderTilt: 0,
  });
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(0);
  const streamRef = useRef(null);
  const poseLandmarkerRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const lastTimestampRef = useRef(0);

  const simulateDetection = () => {
    const blueprint = shotBlueprints[nextBlueprintIndex % shotBlueprints.length];
    const nextShot = createShot(blueprint, shots.length);
    setShots((currentShots) => [...currentShots, nextShot]);
    setNextBlueprintIndex((currentIndex) => currentIndex + 1);
  };

  const resetSession = () => {
    setShots([]);
    setNextBlueprintIndex(0);
  };

  useEffect(() => {
    let isCancelled = false;

    const initializePoseLandmarker = async () => {
      try {
        const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);

        if (isCancelled) {
          return;
        }

        poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MEDIAPIPE_MODEL_ASSET_PATH,
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (isCancelled) {
          poseLandmarkerRef.current?.close();
          return;
        }

        setPoseModelReady(true);
        setPoseStatus('Pose model ready');
      } catch (error) {
        console.error(error);
        setPoseStatus('Pose model failed to load');
        setVideoError('Unable to initialize MediaPipe Pose Landmarker.');
      }
    };

    initializePoseLandmarker();

    return () => {
      isCancelled = true;
      cancelAnimationFrame(animationFrameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      poseLandmarkerRef.current?.close();
    };
  }, []);

  const drawPoseOverlay = (landmarks) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!canvas || !video) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 360;
    canvas.width = width;
    canvas.height = height;

    context.clearRect(0, 0, width, height);

    if (!landmarks?.length) {
      return;
    }

    context.save();
    context.lineWidth = 3;
    context.strokeStyle = 'rgba(122, 209, 255, 0.85)';
    context.fillStyle = 'rgba(255, 209, 112, 0.95)';

    for (const [startIndex, endIndex] of POSE_CONNECTIONS) {
      const start = landmarks[startIndex];
      const end = landmarks[endIndex];

      if (!start || !end) {
        continue;
      }

      context.beginPath();
      context.moveTo(start.x * width, start.y * height);
      context.lineTo(end.x * width, end.y * height);
      context.stroke();
    }

    landmarks.forEach((landmark) => {
      context.beginPath();
      context.arc(landmark.x * width, landmark.y * height, 4, 0, Math.PI * 2);
      context.fill();
    });

    context.restore();
  };

  const stopCamera = () => {
    cancelAnimationFrame(animationFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    drawPoseOverlay([]);
    setCameraActive(false);
    setPoseCount(0);
    setVideoMetrics({ fps: 0, hipDrift: 0, shoulderTilt: 0 });
    setPoseStatus(poseModelReady ? 'Pose model ready' : 'Loading pose model...');
  };

  const runPoseLoop = () => {
    const video = videoRef.current;
    const poseLandmarker = poseLandmarkerRef.current;

    if (!video || !poseLandmarker) {
      return;
    }

    if (video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const timestamp = performance.now();
      const result = poseLandmarker.detectForVideo(video, timestamp);
      const landmarks = result.landmarks?.[0] ?? [];

      setPoseCount(result.landmarks?.length ?? 0);
      drawPoseOverlay(landmarks);

      if (landmarks.length >= 25) {
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        const shoulderTilt = Math.atan2(
          (rightShoulder?.y ?? 0) - (leftShoulder?.y ?? 0),
          (rightShoulder?.x ?? 0) - (leftShoulder?.x ?? 1)
        ) * (180 / Math.PI);
        const hipCenterX = (((leftHip?.x ?? 0) + (rightHip?.x ?? 0)) / 2) - 0.5;
        const elapsed = lastTimestampRef.current ? timestamp - lastTimestampRef.current : 0;
        lastTimestampRef.current = timestamp;

        setVideoMetrics({
          fps: elapsed > 0 ? Math.round(1000 / elapsed) : videoMetrics.fps,
          hipDrift: Number((hipCenterX * 100).toFixed(1)),
          shoulderTilt: Number(shoulderTilt.toFixed(1)),
        });
      }

      result.close();
    }

    animationFrameRef.current = requestAnimationFrame(runPoseLoop);
  };

  const startCamera = async () => {
    if (!poseModelReady) {
      return;
    }

    try {
      setVideoError('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 960 },
          height: { ideal: 540 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraActive(true);
      setPoseStatus('Camera live');
      lastVideoTimeRef.current = -1;
      lastTimestampRef.current = 0;
      animationFrameRef.current = requestAnimationFrame(runPoseLoop);
    } catch (error) {
      console.error(error);
      setVideoError('Camera access was denied or unavailable.');
      setPoseStatus('Camera unavailable');
    }
  };

  const totalShots = shots.length;
  const latestShot = totalShots > 0 ? shots[shots.length - 1] : null;
  const centerHits = shots.filter((shot) => shot.centered).length;
  const centerRate = totalShots > 0 ? Math.round((centerHits / totalShots) * 100) : 0;
  const averageSpeed = totalShots > 0
    ? (shots.reduce((sum, shot) => sum + shot.clubSpeed, 0) / totalShots).toFixed(1)
    : '0.0';
  const averageOffset = totalShots > 0
    ? (shots.reduce((sum, shot) => sum + shot.distance, 0) / totalShots).toFixed(1)
    : '0.0';
  const consistencyScore = totalShots > 0
    ? Math.round(shots.reduce((sum, shot) => sum + shot.score, 0) / totalShots)
    : 0;
  const biasCounts = shots.reduce(
    (counts, shot) => {
      counts[shot.bias] += 1;
      return counts;
    },
    {
      'Fade bias': 0,
      'Draw bias': 0,
      'Neutral flight': 0,
    }
  );
  const pieSegments = [
    { label: 'Fade bias', count: biasCounts['Fade bias'], color: '#ff8d56' },
    { label: 'Draw bias', count: biasCounts['Draw bias'], color: '#68c5ff' },
    { label: 'Neutral flight', count: biasCounts['Neutral flight'], color: '#ffe08d' },
  ];
  const pieGradient = totalShots > 0
    ? (() => {
        let runningPercent = 0;
        const segments = pieSegments
          .filter((segment) => segment.count > 0)
          .map((segment) => {
            const start = runningPercent;
            runningPercent += (segment.count / totalShots) * 100;
            return `${segment.color} ${start}% ${runningPercent}%`;
          });

        return `conic-gradient(${segments.join(', ')})`;
      })()
    : 'conic-gradient(rgba(255,255,255,0.1) 0% 100%)';

  return (
    <div className="app-shell">
      <header className="topbar">
        {showLogo && (
          <img
            className="brand-logo"
            src="/logo.png"
            alt="Nice Only Golfing Solutions"
            onError={() => setShowLogo(false)}
          />
        )}

        <div className="header-actions">
          <article className="top-status-card">
            <span>Smart Club</span>
            <strong>Disconnected</strong>
            <p>SPI sensor sync not wired yet.</p>
          </article>

          <button className="primary-button" onClick={simulateDetection}>
            Simulate Detect
          </button>
          <button className="secondary-button" onClick={resetSession}>
            Reset
          </button>
        </div>
      </header>

      <main className="dashboard-grid">
        <section className="panel heatmap-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Impact Map</p>
              <h2>Club-face strike location</h2>
            </div>
            <span className="badge">Auto trigger: backswing detection</span>
          </div>

          <div className="club-face-wrap">
            {shots.length === 0 && <div className="empty-state">Waiting for first detected swing...</div>}

            <div className="club-face">
              <div className="club-face-ring club-face-ring-inner" />
              <div className="club-face-ring club-face-ring-sweet" />
              <div className="crosshair crosshair-horizontal" />
              <div className="crosshair crosshair-vertical" />

              {shots.map((shot) => (
                <div
                  key={shot.id}
                  className="impact-point"
                style={{
                  left: `calc(50% + ${shot.x * 1.7}px)`,
                  top: `calc(50% + ${shot.y * 1.7}px)`,
                  '--impact-size': `${52 + shot.confidence * 0.62}px`,
                  '--impact-core': shot.x >= 0
                    ? `hsla(${18 - shot.intensity * 10} 100% ${76 - shot.intensity * 16}% / ${0.78 + shot.intensity * 0.18})`
                    : `hsla(${198 - shot.intensity * 14} 100% ${78 - shot.intensity * 16}% / ${0.78 + shot.intensity * 0.18})`,
                  '--impact-glow': shot.x >= 0
                    ? `hsla(${24 - shot.intensity * 16} 100% ${58 - shot.intensity * 14}% / ${0.42 + shot.intensity * 0.26})`
                    : `hsla(${202 - shot.intensity * 14} 100% ${60 - shot.intensity * 14}% / ${0.42 + shot.intensity * 0.26})`,
                }}
                title={`Shot ${shot.index}: ${shot.side}, ${shot.bias}`}
              />
              ))}
            </div>
          </div>

          <div className="legend-row">
            <span>Toe side</span>
            <div className="legend-bar" />
            <span>Heel side</span>
          </div>
          <p className="legend-note">More saturated color means a stronger impact miss away from center.</p>

          <div className="impact-lower-grid">
            <div className="impact-lower-main">
              <section className="panel compact-panel metrics-panel inline-metrics-panel">
                <div className="metrics-summary-row">
                  <div className="score-block">
                    <span>Consistency score</span>
                    <strong>{consistencyScore}</strong>
                    <p>Strike clustering and face-angle stability.</p>
                  </div>

                  <div className="latest-card">
                    <span>Latest swing</span>
                    <strong>{latestShot ? latestShot.bias : 'No shots yet'}</strong>
                    <p>
                      {latestShot
                        ? `Shot ${latestShot.index} on ${latestShot.side.toLowerCase()} at ${Math.round(latestShot.intensity * 100)}% intensity.`
                        : 'Waiting for backswing-triggered capture.'}
                    </p>
                  </div>
                </div>

                <div className="metrics-grid">
                  <article>
                    <span>Total shots</span>
                    <strong>{totalShots}</strong>
                  </article>
                  <article>
                    <span>Center hits</span>
                    <strong>{centerRate}%</strong>
                  </article>
                  <article>
                    <span>Avg club speed</span>
                    <strong>{averageSpeed} mph</strong>
                  </article>
                  <article>
                    <span>Avg offset</span>
                    <strong>{averageOffset} px</strong>
                  </article>
                </div>
              </section>

              <article className="footer-card consistency-info-card">
                <span>Consistency score</span>
                <p>Session average based on strike clustering and face-angle steadiness.</p>
              </article>
            </div>

            <div className="impact-side-cards">
              <article className="footer-card flight-bias-card">
                <span>Flight and bias</span>
                <div className="bias-definition-list">
                  <article className="bias-definition-item">
                    <strong>Fade Bias (Face Open)</strong>
                    <p>
                      Club face angled away from the golfer at impact, usually producing a left-to-right
                      ball flight for a right-handed player.
                    </p>
                  </article>
                  <article className="bias-definition-item">
                    <strong>Draw Bias (Face Closed)</strong>
                    <p>
                      Club face angled toward the golfer at impact, usually producing a right-to-left
                      ball flight for a right-handed player.
                    </p>
                  </article>
                </div>
              </article>

              <article className="footer-card footer-log">
                <div className="footer-log-header">
                  <span>Recent swings</span>
                  <button
                    className="tertiary-button"
                    onClick={() => setShowShotMenu(true)}
                    disabled={shots.length === 0}
                  >
                    View all
                  </button>
                </div>
                <div className="recent-list">
                  {shots.length === 0 && <p>No swings detected yet.</p>}
                  {shots.slice(-3).reverse().map((shot) => (
                    <div className="recent-item" key={`${shot.id}-recent`}>
                      <strong>Shot {shot.index}</strong>
                      <span>{shot.bias}</span>
                      <span>{shot.side}</span>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </div>
        </section>

        <aside className="metrics-column">
          <section className="panel compact-panel video-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Visual Processing</p>
                <h2>Live pose capture</h2>
              </div>
              <span className="badge">{poseStatus}</span>
            </div>

            <div className="video-stage">
              <video className="pose-video" ref={videoRef} autoPlay muted playsInline />
              <canvas className="pose-canvas" ref={canvasRef} />
              {!cameraActive && (
                <div className="video-empty">
                  <strong>Camera preview</strong>
                  <p>MediaPipe Pose Landmarker overlay will appear here once the camera is enabled.</p>
                </div>
              )}
            </div>

            <div className="video-actions">
              <button className="primary-button" onClick={cameraActive ? stopCamera : startCamera} disabled={!poseModelReady && !cameraActive}>
                {cameraActive ? 'Stop Camera' : 'Start Camera'}
              </button>
            </div>

            <div className="video-stats">
              <article>
                <span>Model</span>
                <strong>{poseModelReady ? 'Pose ready' : 'Loading...'}</strong>
              </article>
              <article>
                <span>Poses tracked</span>
                <strong>{poseCount}</strong>
              </article>
              <article>
                <span>FPS</span>
                <strong>{videoMetrics.fps}</strong>
              </article>
              <article>
                <span>Hip drift</span>
                <strong>{videoMetrics.hipDrift}%</strong>
              </article>
              <article>
                <span>Shoulder tilt</span>
                <strong>{videoMetrics.shoulderTilt} deg</strong>
              </article>
            </div>
            {videoError && <p className="video-error">{videoError}</p>}
          </section>

        </aside>
      </main>

      {showShotMenu && (
        <div className="menu-overlay" onClick={() => setShowShotMenu(false)}>
          <section className="shot-menu" onClick={(event) => event.stopPropagation()}>
            <div className="shot-menu-header">
              <div>
                <p className="eyebrow">Detailed View</p>
                <h2>All detected swings</h2>
              </div>
              <button className="secondary-button" onClick={() => setShowShotMenu(false)}>
                Close
              </button>
            </div>

            <div className="shot-menu-chart-panel">
              <div className="bias-chart-block">
                <div className="bias-pie-chart" style={{ background: pieGradient }}>
                  <div className="bias-pie-hole">
                    <strong>{totalShots}</strong>
                    <span>shots</span>
                  </div>
                </div>
              </div>

              <div className="bias-legend">
                {pieSegments.map((segment) => (
                  <div className="bias-legend-item" key={segment.label}>
                    <span className="bias-swatch" style={{ background: segment.color }} />
                    <span>{segment.label}</span>
                    <strong>{segment.count}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="shot-menu-list">
              {shots
                .slice()
                .reverse()
                .map((shot) => (
                  <article className="shot-menu-item" key={`${shot.id}-menu`}>
                    <div>
                      <strong>Shot {shot.index}</strong>
                      <p>{shot.timestamp} session time</p>
                    </div>
                    <div className="shot-menu-metrics">
                      <span>{shot.bias}</span>
                      <span>{shot.side}</span>
                      <span>{shot.clubSpeed.toFixed(1)} mph</span>
                      <span>{shot.score} consistency</span>
                    </div>
                  </article>
                ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
