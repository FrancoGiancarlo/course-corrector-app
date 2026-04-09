import { useState } from 'react';

const shotBlueprints = [
  { x: -34, y: 18, clubSpeed: 103.4, faceAngle: -1.4, confidence: 94 },
  { x: 12, y: -10, clubSpeed: 105.1, faceAngle: 0.2, confidence: 97 },
  { x: 26, y: 16, clubSpeed: 101.6, faceAngle: 1.6, confidence: 89 },
  { x: -8, y: -14, clubSpeed: 106.8, faceAngle: -0.6, confidence: 96 },
  { x: 6, y: 4, clubSpeed: 107.5, faceAngle: 0.1, confidence: 98 },
  { x: -20, y: 9, clubSpeed: 102.3, faceAngle: -1.1, confidence: 92 },
  { x: 30, y: -18, clubSpeed: 100.2, faceAngle: 2.1, confidence: 86 },
  { x: -4, y: 2, clubSpeed: 108.1, faceAngle: 0.0, confidence: 99 },
];

const hardwareStatus = [
  {
    label: 'Smart Club',
    value: 'Disconnected',
    detail: 'SPI sensor sync not wired yet.',
  },
  {
    label: 'Vision Camera',
    value: 'Disconnected',
    detail: 'Camera processing not synced yet.',
  },
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
                    '--impact-size': `${40 + shot.confidence * 0.5}px`,
                    '--impact-glow': shot.x >= 0
                      ? `hsla(${29 - shot.intensity * 22} 100% ${62 - shot.intensity * 20}% / ${0.44 + shot.intensity * 0.42})`
                      : `hsla(${206 - shot.intensity * 18} 96% ${64 - shot.intensity * 18}% / ${0.44 + shot.intensity * 0.42})`,
                  }}
                  title={`Shot ${shot.index}: ${shot.side}, ${shot.bias}`}
                />
              ))}
            </div>
          </div>

          <div className="legend-row">
            <span>Heel side</span>
            <div className="legend-bar" />
            <span>Toe side</span>
          </div>
          <p className="legend-note">More saturated color means a stronger impact miss away from center.</p>
        </section>

        <aside className="metrics-column">
          <section className="panel compact-panel status-panel">
            <div className="status-grid">
              {hardwareStatus.map((item) => (
                <article className="status-card" key={item.label}>
                  <p>{item.label}</p>
                  <strong>{item.value}</strong>
                  <span>{item.detail}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="panel compact-panel metrics-panel">
            <div className="metrics-top">
              <div className="score-block">
                <span>Consistency score</span>
                <strong>{consistencyScore}</strong>
                <p>
                  Combines strike dispersion and face-angle stability. Higher means tighter contact
                  and less face variation.
                </p>
              </div>

              <div className="latest-card">
                <span>Latest swing</span>
                <strong>{latestShot ? latestShot.bias : 'No shots yet'}</strong>
                <p>
                  {latestShot
                    ? `Shot ${latestShot.index} hit ${latestShot.side.toLowerCase()} with ${Math.round(latestShot.intensity * 100)}% intensity.`
                    : 'The dashboard will populate once backswing-triggered capture begins.'}
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
        </aside>
      </main>

      <footer className="footer-strip">
        <article className="footer-card">
          <span>Consistency score</span>
          <p>Session average based on strike clustering and face-angle steadiness.</p>
        </article>
        <article className="footer-card">
          <span>Flight and bias</span>
          <p>
            <strong>Fade Bias (Face Open):</strong> This occurs when the club face is angled away
            from the golfer (pointing right for a right-handed player) at impact. This typically
            results in a ball flight that curves from left to right.
          </p>
          <p>
            <strong>Draw Bias (Face Closed):</strong> This occurs when the club face is angled
            toward the golfer (pointing left for a right-handed player) at impact. This typically
            results in a ball flight that curves from right to left.
          </p>
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
      </footer>

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
