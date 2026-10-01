import { useEffect, useState } from 'react';
import { BACKGROUND_VIDEO_ID, getVideo } from '../lib/videoStore.js';

/**
 * Full-screen looping video background (#25). One video, uploaded in
 * Settings → Slides, stored in THIS device's IndexedDB (never uploaded
 * anywhere) under the single well-known background slot.
 *
 * Rules it must never break:
 *   • muted + playsInline always — a kiosk reload has no user gesture, and
 *     an autoplay block would freeze the whole background;
 *   • never wedge: no stored video, a decode error, or blocked IndexedDB
 *     all fall back to the caller-provided placeholder scene;
 *   • the object URL is revoked on unmount so replacing the video doesn't
 *     leak the old multi-megabyte blob.
 */
// Fired by Settings' VideoUploadField after a successful upload or a remove,
// so a mounted background re-reads the slot without a page reload. The old
// behavior latched the first read forever: with the source already 'video',
// saving Settings changes no prop, React reconciles in place, and a replaced
// video (or a first upload after the "no video" placeholder) never appeared
// until someone reloaded the kiosk.
export const BACKGROUND_VIDEO_CHANGED_EVENT = 'awana:background-video-changed';

export default function VideoBackground({ fallback = null }) {
  // Bumped by the change event; re-runs the load effect from scratch.
  const [generation, setGeneration] = useState(0);
  // Load result, stamped with the generation it belongs to — a stale result
  // (or a stale decode error) from a previous generation is ignored at
  // render time instead of being reset by a synchronous effect write.
  const [loaded, setLoaded] = useState({ gen: -1, url: null, missing: false });
  const [decodeFailedGen, setDecodeFailedGen] = useState(-1);

  useEffect(() => {
    const onChanged = () => setGeneration((g) => g + 1);
    window.addEventListener(BACKGROUND_VIDEO_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(BACKGROUND_VIDEO_CHANGED_EVENT, onChanged);
  }, []);

  useEffect(() => {
    let live = true;
    let objectUrl = null;
    getVideo(BACKGROUND_VIDEO_ID).then((blob) => {
      if (!live) return;
      if (!blob) {
        setLoaded({ gen: generation, url: null, missing: true });
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setLoaded({ gen: generation, url: objectUrl, missing: false });
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [generation]);

  const current = loaded.gen === generation ? loaded : { url: null, missing: false };
  const broken = current.missing || decodeFailedGen === generation;
  const url = current.url;

  if (broken || !url) return fallback;

  return (
    <video
      className="background-video"
      src={url}
      autoPlay
      muted
      loop
      playsInline
      disablePictureInPicture
      // Decode failure (unsupported codec, corrupt file): show the
      // placeholder rather than a black screen with a broken-video glyph.
      onError={() => setDecodeFailedGen(generation)}
    />
  );
}
