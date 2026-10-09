import { useEffect, useRef, useState } from 'react';

export function SwingVideo({ clip, onDelete, deleting = false }) {
  const playerRef = useRef(null);
  const downloadRef = useRef(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(clip.blob);
    playerRef.current.src = objectUrl;
    downloadRef.current.href = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [clip.blob]);
  const extension = clip.blob.type.includes('mp4') ? 'mp4' : 'webm';
  const filename = `swing-${new Date(clip.createdAt).toISOString().replace(/[:.]/g, '-')}.${extension}`;

  return (
    <article className="saved-video">
      <div className="saved-video-heading">
        <div><strong>Recording test</strong><p>{new Date(clip.createdAt).toLocaleString()} · {clip.duration.toFixed(1)}s · {(clip.blob.size / 1024 / 1024).toFixed(1)} MB</p></div>
        <span className="badge badge-neutral">{onDelete ? 'Saved on this device' : 'Not saved yet'}</span>
      </div>
      <video ref={playerRef} controls playsInline preload="metadata" aria-label="Recorded swing video" />
      <div className="saved-video-actions">
        <a ref={downloadRef} className="primary-button" download={filename}>Download video</a>
        {onDelete && (confirmDelete ? <>
          <span>Delete this saved video?</span>
          <button className="secondary-button" disabled={deleting} onClick={() => onDelete(clip.id)}>Delete permanently</button>
          <button className="tertiary-button" onClick={() => setConfirmDelete(false)}>Keep video</button>
        </> : <button className="secondary-button" disabled={deleting} onClick={() => setConfirmDelete(true)}>Delete video</button>)}
      </div>
    </article>
  );
}
