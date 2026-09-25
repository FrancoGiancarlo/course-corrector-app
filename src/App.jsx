import { useState } from 'react';
import { usePoseCamera } from './usePoseCamera';

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
  const {
    videoRef, canvasRef, cameraActive, cameraPending, cameraConnected,
    cameraStatus, modelStatus, poseStatus, poseCount, videoMetrics, videoError,
    cameraDetails, cameras, selectedCamera, setSelectedCamera,
    startCamera, stopCamera, resumeCamera,
  } = usePoseCamera();

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
        <div className="brand">
          {showLogo && (
            <img className="brand-logo" src="/logo.png" alt="Nice Only Golfing Solutions"
              onError={() => setShowLogo(false)} />
          )}
          <div className="brand-title">
            <p className="eyebrow">Practice studio</p>
            <h1>Course Corrector</h1>
          </div>
        </div>
        <div className="header-actions">
          <span className="device-status"><i />Smart club offline</span>
          <button className="secondary-button" onClick={resetSession} disabled={!totalShots}>Reset session</button>
          <button className="primary-button" onClick={simulateDetection}>
            <span aria-hidden="true">+</span> Simulate swing
          </button>
        </div>
      </header>

      <main className="dashboard-grid">
        <section className="session-overview" aria-label="Session overview">
          <article className="score-card">
            <div className="score-ring" style={{ '--score': `${consistencyScore}%` }}>
              <strong>{totalShots ? consistencyScore : '—'}</strong>
            </div>
            <div><span className="stat-label">Consistency</span><p>{totalShots ? 'Session score / 100' : 'Your session starts here'}</p></div>
          </article>
          <article className="summary-stat"><span className="stat-label">Total swings</span><strong>{totalShots.toString().padStart(2, '0')}</strong><span className="stat-note">Simulated session</span></article>
          <article className="summary-stat"><span className="stat-label">Center hits</span><strong>{totalShots ? centerRate : '—'}<small>{totalShots ? '%' : ''}</small></strong><span className="stat-note">{centerHits} on the sweet spot</span></article>
          <article className="summary-stat"><span className="stat-label">Avg. club speed</span><strong>{totalShots ? averageSpeed : '—'}<small>mph</small></strong><span className="stat-note">Across all swings</span></article>
          <article className="summary-stat"><span className="stat-label">Avg. strike offset</span><strong>{totalShots ? averageOffset : '—'}<small>px</small></strong><span className="stat-note">Distance from center</span></article>
        </section>

        <section className="panel heatmap-panel">
          <div className="panel-header">
            <div><p className="eyebrow">01 / Strike analysis</p><h2>Impact map</h2></div>
            <span className="badge badge-neutral">{latestShot ? `Latest: ${latestShot.bias}` : 'Simulation'}</span>
          </div>
          <div className="impact-visual">
            <div className="map-grid" aria-hidden="true" />
            <span className="map-direction map-heel">HEEL</span>
            <span className="map-direction map-toe">TOE</span>
            <div className="club-face-wrap">
              <svg className="club-face" viewBox="0 0 520 280" role="img" aria-label={`Driver club face with ${totalShots} simulated strikes`}>
                <defs>
                  <linearGradient id="driver-metal" x1="0" y1="0" x2="0.2" y2="1">
                    <stop offset="0" stopColor="#71828b" /><stop offset="0.12" stopColor="#354b59" />
                    <stop offset="0.6" stopColor="#243743" /><stop offset="1" stopColor="#13232e" />
                  </linearGradient>
                  <linearGradient id="driver-rim" x1="0" y1="0" x2="0.8" y2="1">
                    <stop offset="0" stopColor="#a1b3bb" /><stop offset="0.5" stopColor="#5c7482" /><stop offset="1" stopColor="#263e4c" />
                  </linearGradient>
                  <clipPath id="driver-face-clip">
                    <path d="M57 74 C109 39 182 26 282 21 C384 16 449 32 479 78 C501 112 502 174 469 209 C431 246 335 259 239 255 C145 251 79 235 47 203 C17 172 19 109 57 74Z" />
                  </clipPath>
                  {shots.map((shot) => <radialGradient id={`strike-${shot.id}`} key={shot.id}>
                    <stop offset="0" stopColor={shot.x >= 0 ? '#ffd4a5' : '#b6ecff'} stopOpacity="0.95" />
                    <stop offset="0.35" stopColor={shot.x >= 0 ? '#ff8d56' : '#68c5ff'} stopOpacity="0.65" />
                    <stop offset="1" stopColor={shot.x >= 0 ? '#ff8d56' : '#68c5ff'} stopOpacity="0" />
                  </radialGradient>)}
                </defs>
                <path d="M30 135 7 92 Q1 80 12 75 L24 70 Q34 66 39 77 L58 116Z" fill="#263b48" stroke="#637d8c" strokeWidth="2" />
                <path d="M57 74 C109 39 182 26 282 21 C384 16 449 32 479 78 C501 112 502 174 469 209 C431 246 335 259 239 255 C145 251 79 235 47 203 C17 172 19 109 57 74Z" fill="url(#driver-metal)" stroke="url(#driver-rim)" strokeWidth="5" />
                <g clipPath="url(#driver-face-clip)">
                  {[65, 90, 115, 140, 165, 190, 215, 240].map((y) => <path key={y} d={`M48 ${y} Q260 ${y - 13} 478 ${y - 7}`} fill="none" stroke="#a1b7c1" strokeOpacity="0.23" strokeWidth="1.5" />)}
                  <path d="M260 46V233M74 140H454" stroke="#c7dfe8" strokeOpacity="0.35" strokeDasharray="3 6" />
                  <ellipse cx="260" cy="140" rx="48" ry="44" fill="#b7ebcd08" stroke="#b7ebcd88" />
                  <path d="M252 140h16m-8-8v16" stroke="#b7ebcd" strokeWidth="1.5" />
                {shots.map((shot) => (
                  <circle key={shot.id} className="impact-point" cx={260 + shot.x * 1.9} cy={140 + shot.y * 1.5}
                    r={25 + shot.intensity * 14} fill={`url(#strike-${shot.id})`}>
                    <title>{`Shot ${shot.index}: ${shot.side}, ${shot.bias}`}</title>
                  </circle>
                ))}
                </g>
              </svg>
            </div>
            <div className="map-caption">{totalShots ? `${totalShots} strikes mapped` : 'Waiting for swing'}</div>
            <div className="legend-row"><span>Heel side</span><div className="legend-bar" /><span>Toe side</span></div>
          </div>
        </section>

        <section className="panel video-panel">
          <div className="panel-header">
            <div><p className="eyebrow">02 / Movement analysis</p><h2>Live pose capture</h2></div>
            <span className={`badge ${cameraActive ? 'badge-live' : 'badge-neutral'}`}><i />{cameraActive ? 'Live' : 'Camera standby'}</span>
          </div>
          <div className="camera-workspace">
          <div className="video-stage">
            <video className="pose-video" ref={videoRef} muted playsInline />
            <canvas className="pose-canvas" ref={canvasRef} />
            <div className="viewfinder" aria-hidden="true"><span /><span /><span /><span /></div>
            {!cameraActive && (
              <div className="video-empty">
                <svg className="camera-symbol" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <rect x="6" y="13" width="36" height="27" rx="6" /><path d="m16 13 3-6h10l3 6" /><circle cx="24" cy="26" r="7" />
                </svg>
                <strong>{cameraPending ? 'Connecting your camera' : cameraStatus === 'paused' ? 'Playback paused' : 'Find your form'}</strong>
                <p>{cameraPending ? 'Allow camera access if prompted.' : cameraStatus === 'paused' ? 'Click Play preview to start the video.' : 'Start your camera and keep your full body in frame.'}</p>
              </div>
            )}
            <span className="video-stage-label">{cameraActive ? 'POSE TRACKING' : 'LIVE PREVIEW'}</span>
          </div>
          <div className="camera-sidebar">
          <div className="video-controls">
            <div className="video-actions">
              <button className={cameraConnected ? 'secondary-button' : 'primary-button'} onClick={cameraConnected ? stopCamera : startCamera}>
                {cameraPending ? 'Cancel camera' : cameraConnected ? 'Stop Camera' : 'Start Camera'}
              </button>
              {cameraStatus === 'paused' && <button className="secondary-button" onClick={resumeCamera}>Play preview</button>}
            </div>
            <span className="camera-status" role="status">{poseStatus}</span>
          </div>
          {cameras.length > 1 && (
            <label className="camera-selector">Camera
              <select value={selectedCamera} disabled={cameraConnected} onChange={(event) => setSelectedCamera(event.target.value)}>
                <option value="">Browser default</option>
                {cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${index + 1}`}</option>)}
              </select>
            </label>
          )}
          <div className="video-stats">
            <article><span>Model</span><strong className={modelStatus === 'ready' ? 'text-mint' : ''}>{modelStatus === 'ready' ? 'Pose ready' : modelStatus === 'error' ? 'Unavailable' : 'Loading...'}</strong></article>
            <article><span>Poses tracked</span><strong>{poseCount}<small> / 1</small></strong></article>
            <article><span>FPS</span><strong>{videoMetrics.fps}</strong></article>
            <article><span>Hip drift</span><strong>{videoMetrics.hipDrift}<small>%</small></strong></article>
            <article><span>Shoulder tilt</span><strong>{videoMetrics.shoulderTilt}<small>°</small></strong></article>
          </div>
          </div>
          </div>
          {videoError && <p className="video-error" role="alert">{videoError}</p>}
          {cameraDetails && !cameraActive && (
            <details className="camera-diagnostics"><summary>Camera diagnostics</summary><pre>{JSON.stringify(cameraDetails, null, 2)}</pre></details>
          )}
        </section>

        <section className="panel recent-panel">
          <div className="panel-header"><div><h2>Recent swings</h2><p className="panel-subtitle">Your last three, at a glance.</p></div>
            <button className="tertiary-button" onClick={() => setShowShotMenu(true)} disabled={!totalShots}>View all <span aria-hidden="true">↗</span></button>
          </div>
          <div className="recent-table-wrap">
            <table className="recent-table">
              <thead><tr><th>Swing</th><th>Flight bias</th><th>Club speed</th><th>Score</th></tr></thead>
              <tbody>
                {shots.slice(-3).reverse().map((shot) => <tr key={shot.id}>
                  <td><span className="shot-number">{shot.index.toString().padStart(2, '0')}</span><span className="shot-side">{shot.side}</span></td>
                  <td><span className={`flight-dot ${shot.bias === 'Fade bias' ? 'dot-fade' : shot.bias === 'Draw bias' ? 'dot-draw' : 'dot-neutral'}`} />{shot.bias}</td>
                  <td>{shot.clubSpeed.toFixed(1)} <small>mph</small></td><td className="table-score">{shot.score}<small> / 100</small></td>
                </tr>)}
                {!totalShots && <tr><td colSpan="4" className="table-empty"><span aria-hidden="true">↗</span><div><strong>A fresh start.</strong><p>Swing to begin your session.</p></div></td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel flight-panel">
          <div className="panel-header"><div><h2>Flight profile</h2><p className="panel-subtitle">See where your session is leaning.</p></div><span className="badge badge-neutral">{totalShots} swings</span></div>
          <div className="flight-distribution">
            {pieSegments.map((segment) => <div className="flight-distribution-row" key={segment.label}>
              <span>{segment.label.replace(' bias', '')}</span>
              <div className="distribution-track"><div style={{ width: `${totalShots ? segment.count / totalShots * 100 : 0}%`, background: segment.color }} /></div>
              <strong>{totalShots ? Math.round(segment.count / totalShots * 100) : 0}<small>%</small></strong>
            </div>)}
          </div>
          <p className="flight-note">For right-handed players: fade moves right, draw moves left.</p>
        </section>
      </main>
      <footer className="app-footer"><span><i />{cameraActive ? 'Camera connected' : 'Ready to practice'}</span><span>Live pose analysis · Simulated swing data</span></footer>

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
