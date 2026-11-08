// @ts-check
// A laptop's screen on a TV, live (owner 2026-11-08: the lobby's Cast screen and
// the Sparks remote: "Screen sharing would be super cool"). ONE copy, browser only,
// no imports; byte copies beside the pages that use it (scripts/family-assets.mjs:
// site/cast/, classroom/public/src/shared/).
//
// WebRTC with NO server in the middle for the picture: the presenter's page makes
// an OFFER, the TV's page an ANSWER, each carried by the sync Worker
// (/v1/cast/signal, /v1/classroom/signal: memory only), then the picture goes
// laptop to TV over the church network. No ICE servers (no STUN, no TURN): both
// are on the church's network; the KVBC Awana app shows its real local address
// (main.js turns off Chromium's mDNS hiding) and the UniFi rule lets guest Wi-Fi
// reach that one computer. Non-trickle: each side sends its description once,
// with every candidate in it (ICE_WAIT_MS at most).

export const ICE_WAIT_MS = 3000;
export const ANSWER_WAIT_MS = 30000;
export const ANSWER_POLL_MS = 1000;
/** Slides and text stay sharp: a high bitrate cap and "detail" over motion. */
export const MAX_BITRATE = 8_000_000;

/** Resolves once the connection has every local candidate (or after ms). @param {RTCPeerConnection} pc @param {number} ms */
export function iceGathered(pc, ms = ICE_WAIT_MS) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); clearTimeout(timer); resolve(undefined); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * The presenter's side: offers the stream, waits for the TV's answer.
 * @param {{
 *   stream: MediaStream,
 *   sendOffer: (sdp: string) => Promise<void>,
 *   readAnswer: () => Promise<string | null>,
 *   onState?: (state: string) => void,
 *   RTC?: typeof RTCPeerConnection,
 *   wait?: { answerMs?: number, pollMs?: number, iceMs?: number },
 * }} o
 * @returns {Promise<{ pc: RTCPeerConnection, stop: () => void }>}
 */
export async function startSharing(o) {
  const RTC = o.RTC || RTCPeerConnection;
  const pc = new RTC({ iceServers: [] });
  const onState = o.onState || (() => {});
  pc.addEventListener('connectionstatechange', () => onState(pc.connectionState));
  for (const track of o.stream.getTracks()) {
    if (track.kind === 'video' && 'contentHint' in track) track.contentHint = 'detail';
    pc.addTrack(track, o.stream);
  }
  const stop = () => { try { pc.close(); } catch { /* closed */ } for (const t of o.stream.getTracks()) t.stop(); };
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc, o.wait?.iceMs);
    for (const s of pc.getSenders()) {
      if (s.track?.kind !== 'video' || !s.getParameters) continue;
      const p = s.getParameters();
      if (p.encodings?.length) { p.encodings[0].maxBitrate = MAX_BITRATE; await s.setParameters(p).catch(() => {}); }
    }
    await o.sendOffer(/** @type {RTCSessionDescription} */ (pc.localDescription).sdp);
    onState('waiting');
    const until = Date.now() + (o.wait?.answerMs ?? ANSWER_WAIT_MS);
    for (;;) {
      const sdp = await o.readAnswer();
      if (sdp) { await pc.setRemoteDescription({ type: 'answer', sdp }); break; }
      if (Date.now() > until) throw new Error('The TV did not answer. Is Cast on, and is this laptop on the church Wi-Fi?');
      await new Promise((r) => setTimeout(r, o.wait?.pollMs ?? ANSWER_POLL_MS));
    }
  } catch (err) {
    stop();
    throw err;
  }
  return { pc, stop };
}

/**
 * The TV's side: answers an offer and hands the picture to onStream.
 * @param {{
 *   offerSdp: string,
 *   sendAnswer: (sdp: string) => Promise<void>,
 *   onStream: (stream: MediaStream) => void,
 *   onState?: (state: string) => void,
 *   RTC?: typeof RTCPeerConnection,
 *   wait?: { iceMs?: number },
 * }} o
 * @returns {Promise<RTCPeerConnection>}
 */
export async function answerShare(o) {
  const RTC = o.RTC || RTCPeerConnection;
  const pc = new RTC({ iceServers: [] });
  pc.addEventListener('track', (ev) => { if (ev.streams && ev.streams[0]) o.onStream(ev.streams[0]); });
  pc.addEventListener('connectionstatechange', () => (o.onState || (() => {}))(pc.connectionState));
  await pc.setRemoteDescription({ type: 'offer', sdp: o.offerSdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await iceGathered(pc, o.wait?.iceMs);
  await o.sendAnswer(/** @type {RTCSessionDescription} */ (pc.localDescription).sdp);
  return pc;
}

/** Can this browser share its screen? (Not iPhones/iPads; most phones.) */
export function canShareScreen() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function'
    && typeof RTCPeerConnection === 'function';
}
