import { useEffect, useRef, useState } from 'react';

const MEDIAPIPE_WASM_ROOT =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MEDIAPIPE_MODEL_ASSET_PATH = '/models/pose_landmarker_lite.task';
const EMPTY_METRICS = { fps: 0, hipDrift: 0, shoulderTilt: 0 };
const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [27, 29], [29, 31], [24, 26], [26, 28], [28, 30], [30, 32],
];

function releaseSession(session, video) {
  if (!session) return;
  session.cancelled = true;
  clearTimeout(session.timeout);
  clearInterval(session.monitor);
  session.events.abort();
  session.stream?.getTracks().forEach((track) => track.stop());
  if (video?.srcObject === session.stream) video.srcObject = null;
}

function drawPose(canvas, video, landmarks = []) {
  const context = canvas?.getContext('2d');
  if (!context || !video) return;
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 360;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context.clearRect(0, 0, width, height);
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(122, 209, 255, 0.85)';
  context.fillStyle = 'rgba(255, 209, 112, 0.95)';
  for (const [startIndex, endIndex] of POSE_CONNECTIONS) {
    const start = landmarks[startIndex];
    const end = landmarks[endIndex];
    if (!start || !end) continue;
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
}

export function usePoseCamera() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const sessionRef = useRef(null);
  const landmarkerRef = useRef(null);
  const [cameraStatus, setCameraStatus] = useState('idle');
  const [modelStatus, setModelStatus] = useState('loading');
  const [cameraError, setCameraError] = useState('');
  const [modelError, setModelError] = useState('');
  const [trackingError, setTrackingError] = useState('');
  const [cameraDetails, setCameraDetails] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [poseCount, setPoseCount] = useState(0);
  const [videoMetrics, setVideoMetrics] = useState(EMPTY_METRICS);

  useEffect(() => {
    let cancelled = false;
    let landmarker;
    const video = videoRef.current;
    const initialize = async () => {
      try {
        const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
        if (cancelled) return;
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MEDIAPIPE_MODEL_ASSET_PATH },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        // Each effect owns its model, including during React StrictMode remounts.
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setModelStatus('ready');
      } catch (error) {
        if (cancelled) return;
        console.error('Pose model initialization error:', error);
        setModelStatus('error');
        setModelError(`Pose model failed to load: ${error.message}`);
      }
    };
    initialize();
    return () => {
      cancelled = true;
      releaseSession(sessionRef.current, video);
      sessionRef.current = null;
      if (landmarkerRef.current === landmarker) landmarkerRef.current = null;
      landmarker?.close();
    };
  }, []);

  useEffect(() => {
    if (cameraStatus !== 'playing' || modelStatus !== 'ready') return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    const session = sessionRef.current;
    let frameId;
    let lastVideoTime = -1;
    let lastTimestamp = 0;
    const runPoseLoop = () => {
      if (session.cancelled) return;
      if (!video.paused && video.readyState >= 2 && video.videoWidth > 0 &&
          video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const timestamp = performance.now();
        let result;
        try {
          result = landmarker.detectForVideo(video, timestamp);
          const landmarks = result.landmarks?.[0] ?? [];
          setPoseCount(result.landmarks?.length ?? 0);
          drawPose(canvas, video, landmarks);
          const elapsed = lastTimestamp ? timestamp - lastTimestamp : 0;
          lastTimestamp = timestamp;
          let hipDrift = 0;
          let shoulderTilt = 0;
          if (landmarks.length >= 25) {
            shoulderTilt = Math.atan2(
              landmarks[12].y - landmarks[11].y,
              landmarks[12].x - landmarks[11].x
            ) * (180 / Math.PI);
            hipDrift = ((landmarks[23].x + landmarks[24].x) / 2 - 0.5) * 100;
          }
          // FPS reflects processed video frames even when nobody is in view.
          setVideoMetrics({
            fps: elapsed > 0 ? Math.round(1000 / elapsed) : 0,
            hipDrift: Number(hipDrift.toFixed(1)),
            shoulderTilt: Number(shoulderTilt.toFixed(1)),
          });
        } catch (error) {
          console.error('Pose tracking error:', error);
          setTrackingError(`Pose tracking stopped: ${error.message}. Stop and restart the camera to retry.`);
          setPoseCount(0);
          setVideoMetrics(EMPTY_METRICS);
          drawPose(canvas, video);
          return;
        } finally {
          result?.close();
        }
      }
      frameId = requestAnimationFrame(runPoseLoop);
    };
    frameId = requestAnimationFrame(runPoseLoop);
    return () => {
      cancelAnimationFrame(frameId);
      drawPose(canvas, video);
    };
  }, [cameraStatus, modelStatus]);

  const stopCamera = () => {
    releaseSession(sessionRef.current, videoRef.current);
    sessionRef.current = null;
    drawPose(canvasRef.current, videoRef.current);
    setCameraStatus('idle');
    setCameraError('');
    setTrackingError('');
    setPoseCount(0);
    setVideoMetrics(EMPTY_METRICS);
    setCameraDetails(null);
  };

  const startCamera = async () => {
    // A ref also guards clicks that arrive before React renders the new state.
    if (sessionRef.current) return;
    const session = { cancelled: false, events: new AbortController() };
    sessionRef.current = session;
    setCameraStatus('requesting');
    setCameraError('');
    setTrackingError('');
    setCameraDetails(null);
    const video = videoRef.current;
    const fail = (error) => {
      if (session.cancelled) return;
      console.error('Camera error:', error);
      releaseSession(session, video);
      sessionRef.current = null;
      setCameraError(`Camera error: ${error.name ?? 'Error'} - ${error.message}`);
      setCameraStatus('error');
      setPoseCount(0);
      setVideoMetrics(EMPTY_METRICS);
    };
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access requires localhost or HTTPS and a supported browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        // Start with the device's default format instead of requesting 960x540.
        video: selectedCamera ? { deviceId: { exact: selectedCamera } } : true,
        audio: false,
      });
      // Permission can be granted after Stop Camera, navigation, or hot reload.
      if (session.cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      session.stream = stream;
      if (!video) throw new Error('Video element not found.');
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') throw new Error('The camera did not provide a live video track.');
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        if (!session.cancelled) setCameras(devices.filter((device) => device.kind === 'videoinput'));
      }).catch((error) => console.warn('Unable to list cameras:', error));
      const options = { signal: session.events.signal };
      const inspectVideo = () => {
        const details = {
          camera: track.label || 'Selected camera',
          track: track.readyState,
          muted: track.muted,
          enabled: track.enabled,
          readyState: video.readyState,
          resolution: `${video.videoWidth} x ${video.videoHeight}`,
          paused: video.paused,
          play: session.playState || 'Not requested',
        };
        setCameraDetails(details);
        return video.readyState >= 2 && video.videoWidth > 0 && !video.paused;
      };
      const markPlaying = () => {
        if (session.cancelled || !inspectVideo()) return;
        clearTimeout(session.timeout);
        clearInterval(session.monitor);
        setCameraError('');
        setCameraStatus('playing');
      };
      const watchPlayback = () => {
        clearTimeout(session.timeout);
        clearInterval(session.monitor);
        // Also observe readiness in case an event is missed by the browser.
        session.monitor = setInterval(markPlaying, 250);
        session.timeout = setTimeout(() => {
          if (session.cancelled) return;
          if (inspectVideo()) {
            markPlaying();
            return;
          }
          clearInterval(session.monitor);
          if (session.playState === 'NotAllowedError') {
            setCameraStatus('paused');
            setCameraError('Firefox blocked playback. Click Play preview to allow it.');
          } else if (video.readyState < 2 || video.videoWidth === 0) {
            fail(new Error(
              `No video frames received from ${track.label || 'the camera'}. Close other apps or tabs using this camera, check its privacy switch, then start it again or choose another camera.`
            ));
          } else {
            setCameraStatus('paused');
            setCameraError('Video data is available, but playback is paused. Click Play preview.');
          }
        }, 10000);
      };
      session.requestPlayback = () => {
        if (session.cancelled || session.playPending) return;
        session.playPending = true;
        session.playState = 'Pending';
        setCameraStatus('starting');
        setCameraError('');
        watchPlayback();
        // Call from Start Camera or directly from the Play preview user gesture.
        video.play().then(() => {
          if (session.cancelled) return;
          session.playState = 'Resolved';
          markPlaying();
        }).catch((error) => {
          if (session.cancelled) return;
          session.playState = error.name;
          inspectVideo();
          setCameraStatus('paused');
          setCameraError(`Playback error: ${error.name} - ${error.message}. Click Play preview to retry.`);
        }).finally(() => { session.playPending = false; });
      };
      video.addEventListener('playing', markPlaying, options);
      video.addEventListener('pause', () => {
        setCameraStatus('paused');
        setVideoMetrics(EMPTY_METRICS);
        setPoseCount(0);
      }, options);
      video.addEventListener('error', () => fail(new Error(
        video.error?.message || 'The browser could not display the camera stream.'
      )), options);
      track.addEventListener('ended', () => fail(new Error(
        'The camera disconnected or permission was revoked. Start the camera again.'
      )), options);
      setCameraStatus('starting');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      session.requestPlayback();
    } catch (error) {
      fail(error);
    }
  };

  // An explicit user gesture can recover when browser autoplay is blocked.
  const resumeCamera = () => {
    const session = sessionRef.current;
    if (!session || session.cancelled) return;
    session.requestPlayback();
  };

  const cameraActive = cameraStatus === 'playing';
  const cameraPending = cameraStatus === 'requesting' || cameraStatus === 'starting';
  const cameraConnected = cameraActive || cameraStatus === 'paused' || cameraPending;
  const poseStatus = cameraActive
    ? (trackingError || modelStatus === 'error' ? 'Camera live · tracking unavailable'
      : modelStatus === 'ready' ? 'Camera live' : 'Camera live · loading model...')
    : cameraStatus === 'requesting' ? 'Waiting for camera permission...'
      : cameraStatus === 'starting' ? 'Starting camera...'
        : cameraStatus === 'paused' ? 'Camera playback paused'
          : cameraStatus === 'error' ? 'Camera unavailable'
            : modelStatus === 'ready' ? 'Pose model ready'
              : modelStatus === 'error' ? 'Pose model failed to load' : 'Loading pose model...';

  return {
    videoRef, canvasRef, cameraActive, cameraPending, cameraConnected,
    cameraStatus, modelStatus, poseStatus, poseCount, videoMetrics,
    cameraDetails, cameras, selectedCamera, setSelectedCamera,
    videoError: [cameraError, modelError, trackingError].filter(Boolean).join(' '),
    startCamera, stopCamera, resumeCamera,
  };
}
