import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerMessage, VoiceParticipant, VoiceSignal } from '@leekha/protocol';
import type { GameSocket } from '../net/socket';

// Client half of the peer-to-peer voice mesh (SPEC-VOICE.md). Media is
// browser-to-browser WebRTC; this hook owns one RTCPeerConnection per other
// participant, the local mic track, join/mute state, and a locally-computed
// "who is speaking" signal. Signaling (offer/answer/ICE) rides the existing
// GameSocket via voice.* messages; no audio ever touches the server.

/** Public STUN only for the MVP. A managed TURN relay is a later, env-driven addition (SPEC-VOICE.md §1). */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

export type VoiceError = 'unsupported' | 'permission' | 'mic' | 'voice-full' | 'voice-disabled' | 'not-in-room';
const VOICE_ERROR_CODES = new Set(['voice-full', 'voice-disabled', 'not-in-room']);

export interface VoiceController {
  supported: boolean;
  joined: boolean;
  connecting: boolean;
  muted: boolean;
  error: VoiceError | null;
  clearError: () => void;
  /** Other participants (never includes self). */
  participants: VoiceParticipant[];
  self: string | null;
  /** voiceId -> currently talking (includes self under its own voiceId). */
  speaking: Record<string, boolean>;
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
}

export interface VoiceContext {
  roomCode: string | null;
  seated: boolean;
  allowSpectatorVoice: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  /** Auto-join voice once per room when the player opts in (settings.voiceAutoJoin). */
  autoJoin: boolean;
}

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  audio: HTMLAudioElement;
  analyser?: AnalyserNode;
}

function isSupported(): boolean {
  return (
    typeof RTCPeerConnection !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

export function useVoiceLobby(socket: GameSocket | null, ctx: VoiceContext): VoiceController {
  const supported = isSupported();

  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<VoiceError | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [self, setSelf] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});

  // Refs mirror the reactive state for use inside socket callbacks that close
  // over a single render, plus the imperative WebRTC objects React never sees.
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const selfRef = useRef<string | null>(null);
  const mutedRef = useRef(false);
  const joinIntentRef = useRef(false); // the user WANTS voice on (survives a reconnect blip)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const socketRef = useRef<GameSocket | null>(socket);
  socketRef.current = socket;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const send = useCallback((msg: Parameters<GameSocket['send']>[0]) => socketRef.current?.send(msg), []);

  // ---- speaking detection (local, no signaling) ----

  const ensureAudioCtx = useCallback((): AudioContext | null => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtxRef.current = new Ctor();
    return audioCtxRef.current;
  }, []);

  const attachAnalyser = useCallback(
    (stream: MediaStream): AnalyserNode | undefined => {
      const ac = ensureAudioCtx();
      if (!ac) return undefined;
      const src = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      return analyser;
    },
    [ensureAudioCtx],
  );

  const localAnalyserRef = useRef<AnalyserNode | undefined>(undefined);

  const startSpeakingLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    const buf = new Uint8Array(256);
    let last = 0;
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const now = performance.now();
      if (now - last < 100) return; // ~10fps is plenty for a talking dot
      last = now;
      const next: Record<string, boolean> = {};
      const level = (an?: AnalyserNode): boolean => {
        if (!an) return false;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        return Math.sqrt(sum / buf.length) > 0.04;
      };
      const selfId = selfRef.current;
      if (selfId) next[selfId] = !mutedRef.current && level(localAnalyserRef.current);
      for (const [id, peer] of peersRef.current) next[id] = level(peer.analyser);
      setSpeaking((prev) => {
        // Only re-render when something actually flipped.
        const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
        for (const k of keys) if ((prev[k] ?? false) !== (next[k] ?? false)) return next;
        return prev;
      });
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopSpeakingLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setSpeaking({});
  }, []);

  // ---- peer lifecycle ----

  const sendSignal = useCallback(
    (to: string, signal: VoiceSignal) => send({ type: 'voice.signal', to, signal }),
    [send],
  );

  const closePeer = useCallback((voiceId: string) => {
    const peer = peersRef.current.get(voiceId);
    if (!peer) return;
    try {
      peer.pc.ontrack = null;
      peer.pc.onicecandidate = null;
      peer.pc.onnegotiationneeded = null;
      peer.pc.close();
    } catch {
      /* already closed */
    }
    peer.audio.srcObject = null;
    peer.audio.remove();
    peersRef.current.delete(voiceId);
  }, []);

  const ensurePeer = useCallback(
    (voiceId: string): Peer | null => {
      const existing = peersRef.current.get(voiceId);
      if (existing) return existing;
      const selfId = selfRef.current;
      const local = localStreamRef.current;
      if (!selfId || !local) return null;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const audio = document.createElement('audio');
      audio.autoplay = true;
      // iOS Safari refuses to play audio from an element that isn't in the DOM
      // and needs playsinline; keep it attached but silent/hidden.
      audio.setAttribute('playsinline', 'true');
      audio.style.display = 'none';
      document.body.appendChild(audio);

      const peer: Peer = { pc, polite: selfId > voiceId, makingOffer: false, ignoreOffer: false, audio };
      peersRef.current.set(voiceId, peer);

      for (const track of local.getTracks()) pc.addTrack(track, local);

      pc.onnegotiationneeded = async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) sendSignal(voiceId, { kind: 'offer', sdp: pc.localDescription.sdp });
        } catch {
          /* transient; ICE restart / renegotiation will retry */
        } finally {
          peer.makingOffer = false;
        }
      };
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          sendSignal(voiceId, {
            kind: 'ice',
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
          });
        }
      };
      pc.ontrack = ({ streams }) => {
        const remote = streams[0];
        if (!remote) return;
        peer.audio.srcObject = remote;
        peer.audio.play().catch(() => {
          /* autoplay may be blocked until a gesture; the Join tap unlocks it */
        });
        peer.analyser = attachAnalyser(remote);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          try {
            pc.restartIce();
          } catch {
            /* older browsers: the roster will rebuild on the next join */
          }
        }
      };
      return peer;
    },
    [attachAnalyser, sendSignal],
  );

  const handleSignal = useCallback(
    async (from: string, signal: VoiceSignal) => {
      const peer = ensurePeer(from);
      if (!peer) return;
      const { pc } = peer;
      try {
        if (signal.kind === 'ice') {
          try {
            await pc.addIceCandidate({
              candidate: signal.candidate,
              sdpMid: signal.sdpMid,
              sdpMLineIndex: signal.sdpMLineIndex,
            });
          } catch {
            if (!peer.ignoreOffer) throw new Error('ice');
          }
          return;
        }
        // offer / answer — perfect negotiation (MDN).
        const collision = signal.kind === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription({ type: signal.kind, sdp: signal.sdp });
        if (signal.kind === 'offer') {
          await pc.setLocalDescription();
          if (pc.localDescription) sendSignal(from, { kind: 'answer', sdp: pc.localDescription.sdp });
        }
      } catch {
        /* swallow: a dropped negotiation heals on the next renegotiation/rejoin */
      }
    },
    [ensurePeer, sendSignal],
  );

  // ---- teardown ----

  const teardownMesh = useCallback(() => {
    for (const id of [...peersRef.current.keys()]) closePeer(id);
    setParticipants([]);
  }, [closePeer]);

  const stopLocal = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    localAnalyserRef.current = undefined;
    stopSpeakingLoop();
  }, [stopSpeakingLoop]);

  const leave = useCallback(() => {
    joinIntentRef.current = false;
    send({ type: 'voice.leave' });
    teardownMesh();
    stopLocal();
    selfRef.current = null;
    setSelf(null);
    setJoined(false);
    setConnecting(false);
  }, [send, teardownMesh, stopLocal]);

  // ---- join ----

  const acquireMicAndAnnounce = useCallback(async () => {
    setConnecting(true);
    try {
      if (!localStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        localStreamRef.current = stream;
        // Reapply the current mute preference to the fresh track.
        stream.getAudioTracks().forEach((t) => (t.enabled = !mutedRef.current));
        // The Join tap is a user gesture, so resume the (often suspended)
        // AudioContext now, or the speaking meters read silence.
        await ensureAudioCtx()?.resume().catch(() => {});
        localAnalyserRef.current = attachAnalyser(stream);
        startSpeakingLoop();
      }
      send({ type: 'voice.join' });
      setJoined(true);
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'permission' : 'mic');
      joinIntentRef.current = false;
      stopLocal();
      setJoined(false);
    } finally {
      setConnecting(false);
    }
  }, [attachAnalyser, ensureAudioCtx, send, startSpeakingLoop, stopLocal]);

  const join = useCallback(() => {
    if (!supported) {
      setError('unsupported');
      return;
    }
    if (joinIntentRef.current || !ctxRef.current.roomCode) return;
    setError(null);
    joinIntentRef.current = true;
    void acquireMicAndAnnounce();
  }, [supported, acquireMicAndAnnounce]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    send({ type: 'voice.state', muted: next });
  }, [send]);

  const clearError = useCallback(() => setError(null), []);

  // ---- inbound messages ----

  useEffect(() => {
    if (!socket) return;
    const off = socket.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'voice.roster': {
          selfRef.current = msg.self;
          setSelf(msg.self);
          setParticipants(msg.participants);
          for (const p of msg.participants) ensurePeer(p.voiceId);
          break;
        }
        case 'voice.joined': {
          if (msg.participant.voiceId === selfRef.current) break;
          setParticipants((prev) =>
            prev.some((p) => p.voiceId === msg.participant.voiceId) ? prev : [...prev, msg.participant],
          );
          ensurePeer(msg.participant.voiceId);
          break;
        }
        case 'voice.left': {
          closePeer(msg.voiceId);
          setParticipants((prev) => prev.filter((p) => p.voiceId !== msg.voiceId));
          setSpeaking((prev) => {
            if (!(msg.voiceId in prev)) return prev;
            const next = { ...prev };
            delete next[msg.voiceId];
            return next;
          });
          break;
        }
        case 'voice.signal': {
          void handleSignal(msg.from, msg.signal);
          break;
        }
        case 'voice.state': {
          setParticipants((prev) =>
            prev.map((p) => (p.voiceId === msg.voiceId ? { ...p, muted: msg.muted } : p)),
          );
          break;
        }
        case 'error': {
          if (VOICE_ERROR_CODES.has(msg.code)) {
            setError(msg.code as VoiceError);
            joinIntentRef.current = false;
            teardownMesh();
            stopLocal();
            setJoined(false);
            setConnecting(false);
          }
          break;
        }
      }
    });
    return off;
  }, [socket, ensurePeer, closePeer, handleSignal, teardownMesh, stopLocal]);

  // ---- reconnect: rebuild the mesh after a socket blip ----

  const prevStatusRef = useRef(ctx.connectionStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = ctx.connectionStatus;
    if (ctx.connectionStatus === 'disconnected') {
      // Every peer connection is dead once the socket dropped; drop them but
      // keep the mic and the intent so we can transparently rejoin.
      if (joinIntentRef.current) teardownMesh();
      return;
    }
    if (ctx.connectionStatus === 'connected' && prev !== 'connected' && joinIntentRef.current) {
      // Give the game hook's auth/resync replay a beat to re-establish the
      // room binding on the server before we ask to rejoin voice.
      const t = window.setTimeout(() => {
        if (joinIntentRef.current && ctxRef.current.roomCode) send({ type: 'voice.join' });
      }, 700);
      return () => window.clearTimeout(t);
    }
  }, [ctx.connectionStatus, teardownMesh, send]);

  // If spectator voice is switched off while a seatless watcher is in it, the
  // server drops them (voice.left for self never comes, so mirror it here).
  useEffect(() => {
    if (joined && !ctx.seated && !ctx.allowSpectatorVoice) leave();
  }, [joined, ctx.seated, ctx.allowSpectatorVoice, leave]);

  // Leaving the room entirely (roomCode cleared) tears voice down.
  useEffect(() => {
    if (joinIntentRef.current && !ctx.roomCode) leave();
  }, [ctx.roomCode, leave]);

  // Auto-join once per room for players who opted in. Keyed on the room code so
  // a manual Leave inside the same room is respected (we don't re-join it), but
  // entering a different room auto-joins again.
  const autoJoinedRoomRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ctx.autoJoin || !ctx.roomCode) return;
    if (autoJoinedRoomRef.current === ctx.roomCode) return;
    if (ctx.connectionStatus !== 'connected') return;
    autoJoinedRoomRef.current = ctx.roomCode;
    join();
  }, [ctx.autoJoin, ctx.roomCode, ctx.connectionStatus, join]);

  // Unmount safety.
  useEffect(() => {
    return () => {
      teardownMesh();
      stopLocal();
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    supported,
    joined,
    connecting,
    muted,
    error,
    clearError,
    participants,
    self,
    speaking,
    join,
    leave,
    toggleMute,
  };
}
