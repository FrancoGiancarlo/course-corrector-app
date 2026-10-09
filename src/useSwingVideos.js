import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteVideo, listVideos, MAX_VIDEOS, MAX_VIDEO_BYTES, saveVideo } from './swingVideoStore';

const RECORD_SECONDS = 8;

export function useSwingVideos(videoRef) {
  const [videos, setVideos] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unsaved, setUnsaved] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const active = useRef(null);
  const mounted = useRef(false);
  const writing = useRef(false);
  const supported = typeof MediaRecorder !== 'undefined';

  const refresh = useCallback(async () => {
    try {
      const saved = await listVideos();
      if (mounted.current) {
        setVideos(saved);
        setLoaded(true);
      }
    } catch (cause) {
      if (mounted.current) setError(`Cannot read saved videos: ${cause.message}`);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', refresh);
      const session = active.current;
      if (session) {
        session.cancelled = true;
        clearInterval(session.timer);
        if (session.recorder?.state !== 'inactive') session.recorder?.stop();
        session.stream?.getTracks().forEach((track) => track.stop());
      }
      active.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (phase === 'idle' && !unsaved) return;
    const warnBeforeLeaving = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [phase, unsaved]);

  const persist = async (clip) => {
    if (writing.current) return;
    writing.current = true;
    setPhase('saving');
    setError('');
    try {
      await saveVideo(clip);
      if (mounted.current) {
        setVideos((current) => [clip, ...current.filter((video) => video.id !== clip.id)]
          .sort((a, b) => b.createdAt - a.createdAt));
        setUnsaved(null);
        setNotice('Video saved. Open Recent swings → View all to play or download it.');
        await refresh();
      }
    } catch (cause) {
      if (mounted.current) {
        setUnsaved(clip);
        setError(cause.name === 'QuotaExceededError'
          ? 'Browser storage is full. Download this video or delete a saved clip and retry.'
          : `Video was not saved: ${cause.message}`);
      }
    } finally {
      writing.current = false;
      if (mounted.current) setPhase('idle');
    }
  };

  const stopRecording = () => {
    const session = active.current;
    if (!session) return;
    clearInterval(session.timer);
    if (!session.recorder) {
      session.cancelled = true;
      active.current = null;
      setPhase('idle');
      setNotice('Recording cancelled.');
    } else if (session.recorder.state !== 'inactive') {
      setPhase('saving');
      session.recorder.stop();
    }
  };

  const startTest = () => {
    if (active.current || writing.current || unsaved || !loaded || videos.length >= MAX_VIDEOS) return;
    setError('');
    setNotice('');
    if (!supported) {
      setError('Video recording is unavailable in this browser. Try a current browser with MediaRecorder support.');
      return;
    }
    const source = videoRef.current?.srcObject;
    if (!source?.getVideoTracks().some((track) => track.readyState === 'live')) {
      setError('Start the camera before recording a test.');
      return;
    }
    const session = { cancelled: false, remaining: 3 };
    active.current = session;
    setPhase('countdown');
    setSeconds(3);
    session.timer = setInterval(() => {
      session.remaining -= 1;
      setSeconds(session.remaining);
      if (session.remaining > 0) return;
      clearInterval(session.timer);
      try {
        if (!source.getVideoTracks().some((track) => track.readyState === 'live')) {
          throw new Error('The camera disconnected. Start it again to record.');
        }
        // Own the recording tracks so cleanup never stops the live preview.
        session.stream = new MediaStream(source.getVideoTracks().map((track) => track.clone()));
        const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
          .find((type) => MediaRecorder.isTypeSupported(type));
        const recorder = new MediaRecorder(session.stream, {
          ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 2_500_000,
        });
        session.recorder = recorder;
        const chunks = [];
        let bytes = 0;
        recorder.ondataavailable = (event) => {
          if (event.data.size) {
            chunks.push(event.data);
            bytes += event.data.size;
            if (bytes >= MAX_VIDEO_BYTES && recorder.state !== 'inactive') stopRecording();
          }
        };
        recorder.onerror = () => {
          session.failed = true;
          clearInterval(session.timer);
          session.stream.getTracks().forEach((track) => track.stop());
          if (recorder.state !== 'inactive') recorder.stop();
          if (mounted.current) {
            setError('Recording failed. Please start a new test.');
            setPhase('idle');
          }
          if (active.current === session) active.current = null;
        };
        recorder.onstop = () => {
          clearInterval(session.timer);
          session.stream.getTracks().forEach((track) => track.stop());
          if (active.current === session) active.current = null;
          if (session.cancelled || session.failed || !mounted.current) return;
          const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'video/webm' });
          if (!blob.size) {
            setError('The camera produced an empty video. Please record again.');
            setPhase('idle');
            return;
          }
          persist({
            id: crypto.randomUUID(), kind: 'video', createdAt: session.createdAt,
            duration: (performance.now() - session.startedAt) / 1000,
            trigger: 'timed-test', blob,
          });
        };
        session.createdAt = Date.now();
        session.startedAt = performance.now();
        recorder.start(250);
        setPhase('recording');
        setSeconds(RECORD_SECONDS);
        session.timer = setInterval(() => {
          const remaining = Math.max(0, RECORD_SECONDS - Math.floor((performance.now() - session.startedAt) / 1000));
          setSeconds(remaining);
          if (!remaining) stopRecording();
        }, 200);
      } catch (cause) {
        session.cancelled = true;
        clearInterval(session.timer);
        if (session.recorder?.state !== 'inactive') session.recorder?.stop();
        session.stream?.getTracks().forEach((track) => track.stop());
        active.current = null;
        setPhase('idle');
        setError(`Cannot record video: ${cause.message}`);
      }
    }, 1000);
  };

  const removeVideo = async (id) => {
    setDeleting(true);
    setError('');
    try {
      await deleteVideo(id);
      await refresh();
    } catch (cause) {
      setError(`Cannot delete video: ${cause.message}`);
    } finally {
      if (mounted.current) setDeleting(false);
    }
  };

  return {
    videos, loaded, phase, seconds, error, notice, unsaved, supported, deleting,
    startTest, stopRecording, removeVideo, refresh,
    retrySave: () => unsaved && persist(unsaved),
    discardUnsaved: () => { setUnsaved(null); setError(''); },
  };
}
