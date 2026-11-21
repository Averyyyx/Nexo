import { useCallback, useEffect, useRef, useState } from 'react';
import SimplePeer from 'simple-peer';
import { Camera, CameraOff, Mic, MicOff, MonitorUp, PhoneOff, Volume2, VolumeX, UserPlus, X, MoreHorizontal } from 'lucide-react';
import type { Channel, Server, User, VoiceState } from '../types';
import { apiFetch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { playNexoSound } from '../lib/sounds';
import { Avatar } from './Avatar';
import { Select, Slider, Switch } from './ui';

type VoiceMember = {
  user: { id: number; username: string; display_name: string; avatar_url: string; avatar_color?: string };
  muted: boolean;
  deafened: boolean;
  canSpeak?: boolean;
  canStream?: boolean;
  joined_at: string;
};

type VoiceRoomProps = {
  server: Server;
  channel: Channel;
  user: User;
  micMuted: boolean;
  deafened: boolean;
  audioInputId?: string;
  audioOutputId?: string;
  videoInputId?: string;
  onToggleMic: () => void;
  onToggleDeafen: () => void;
  onLeave: () => void;
};

export function VoiceRoom({ server, channel, user, micMuted, deafened, audioInputId = '', audioOutputId = '', videoInputId = '', onToggleMic, onToggleDeafen, onLeave }: VoiceRoomProps) {
  const [participants, setParticipants] = useState<VoiceMember[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<number, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [remoteSpeakingIds, setRemoteSpeakingIds] = useState<number[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [serverMembers, setServerMembers] = useState<Array<{ id: number; user: { id: number; username: string; display_name: string; avatar_url: string; avatar_color?: string } }>>([]);
  const [inviteStatus, setInviteStatus] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [remoteVolume, setRemoteVolume] = useState(1);
  const [tileSize, setTileSize] = useState<'compact' | 'comfortable' | 'large'>('comfortable');
  const peers = useRef(new Map<number, SimplePeer.Instance>());
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const joinedRef = useRef(false);
  const audioRefs = useRef<Record<number, HTMLAudioElement | null>>({});
  const analyserFrame = useRef<number | null>(null);

  const closePeer = useCallback((peerId: number) => {
    const peer = peers.current.get(peerId);
    if (peer) {
      peer.removeAllListeners();
      peer.destroy();
      peers.current.delete(peerId);
    }
    setRemoteStreams((current) => {
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }, []);

  const createPeer = useCallback((peerId: number, initiator: boolean, socket: ReturnType<typeof getSocket>) => {
    const existing = peers.current.get(peerId);
    if (existing) return existing;
    const stream = localRef.current;
    if (!stream) return null;
    const peer = new SimplePeer({ initiator, trickle: true, stream, config: {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }]
    } });
    peers.current.set(peerId, peer);
    peer.on('signal', (payload) => socket.emit('voice:signal', { channelId: channel.id, to: peerId, payload }));
    peer.on('stream', (remote) => setRemoteStreams((current) => ({ ...current, [peerId]: remote })));
    peer.on('close', () => closePeer(peerId));
    peer.on('error', (reason) => {
      setError(reason.message || 'Ошибка голосового соединения.');
      closePeer(peerId);
    });
    const display = screenRef.current;
    if (display) display.getVideoTracks().forEach((track) => peer.addTrack(track, display));
    const camera = cameraRef.current;
    if (camera) camera.getVideoTracks().forEach((track) => peer.addTrack(track, camera));
    return peer;
  }, [channel.id, closePeer]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('nexo-voice-participants', { detail: { channelId: channel.id, participants } }));
  }, [channel.id, participants]);

  useEffect(() => {
    const ids = [...remoteSpeakingIds, ...(speaking ? [user.id] : [])];
    window.dispatchEvent(new CustomEvent('nexo-voice-speaking', { detail: { channelId: channel.id, userIds: ids } }));
  }, [channel.id, remoteSpeakingIds, speaking, user.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((track) => { track.enabled = !micMuted && participants.find((p) => p.user.id === user.id)?.canSpeak !== false; });
  }, [localStream, micMuted, participants, user.id]);

  useEffect(() => {
    if (!joinedRef.current || !localRef.current) return;
    let cancelled = false;
    void navigator.mediaDevices.getUserMedia({
      audio: audioInputId ? { deviceId: { exact: audioInputId }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true },
      video: false
    }).then((replacementStream) => {
      if (cancelled) { replacementStream.getTracks().forEach((track) => track.stop()); return; }
      const currentStream = localRef.current;
      const nextTrack = replacementStream.getAudioTracks()[0];
      const oldTrack = currentStream?.getAudioTracks()[0];
      if (!currentStream || !nextTrack) { replacementStream.getTracks().forEach((track) => track.stop()); return; }
      if (oldTrack) peers.current.forEach((peer) => { try { peer.replaceTrack(oldTrack, nextTrack, currentStream); } catch {} });
      if (oldTrack) { currentStream.removeTrack(oldTrack); oldTrack.stop(); }
      currentStream.addTrack(nextTrack);
      setLocalStream(new MediaStream(currentStream.getTracks()));
    }).catch((reason) => setError((reason as Error).message || 'Не удалось переключить микрофон.'));
    return () => { cancelled = true; };
  }, [audioInputId, joinedAt]);



  useEffect(() => {
    localStream?.getAudioTracks().forEach((track) => { void track.applyConstraints({ noiseSuppression }).catch(() => {}); });
  }, [localStream, noiseSuppression]);

  useEffect(() => {
    Object.values(audioRefs.current).forEach((audio) => {
      if (!audio) return;
      audio.muted = deafened;
      audio.volume = remoteVolume;
      const sink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (audioOutputId && sink.setSinkId) void sink.setSinkId(audioOutputId).catch(() => {});
    });
  }, [remoteStreams, deafened, audioOutputId, remoteVolume]);

  useEffect(() => {
    const entries = Object.entries(remoteStreams).filter(([, stream]) => stream.getAudioTracks().length);
    if (!entries.length) { setRemoteSpeakingIds([]); return; }
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const analysers = new Map<number, AnalyserNode>();
    entries.forEach(([id, stream]) => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      analysers.set(Number(id), analyser);
    });
    const buffers = new Map(Array.from(analysers.keys()).map((id) => [id, new Uint8Array(analysers.get(id)!.frequencyBinCount)]));
    let active = true;
    let frame = 0;
    const sample = () => {
      if (!active) return;
      const speakingIds: number[] = [];
      analysers.forEach((analyser, id) => {
        const values = buffers.get(id)!;
        analyser.getByteFrequencyData(values);
        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        if (average > 17) speakingIds.push(id);
      });
      setRemoteSpeakingIds(speakingIds);
      frame = window.requestAnimationFrame(sample);
    };
    sample();
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      void context.close();
      setRemoteSpeakingIds([]);
    };
  }, [remoteStreams]);

  useEffect(() => {
    if (!localStream) return;
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const source = context.createMediaStreamSource(localStream);
    source.connect(analyser);
    const values = new Uint8Array(analyser.frequencyBinCount);
    let active = true;
    const sample = () => {
      if (!active) return;
      analyser.getByteFrequencyData(values);
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      setSpeaking(average > 17 && !micMuted && !deafened);
      analyserFrame.current = window.requestAnimationFrame(sample);
    };
    sample();
    return () => {
      active = false;
      if (analyserFrame.current !== null) window.cancelAnimationFrame(analyserFrame.current);
      source.disconnect();
      void context.close();
      setSpeaking(false);
    };
  }, [localStream, micMuted, deafened]);

  useEffect(() => {
    let disposed = false;
    const socket = getSocket();
    const onPeers = ({ channelId, peers: remotePeers }: { channelId: number; peers: VoiceMember[] }) => {
      if (channelId !== channel.id || disposed) return;
      setParticipants((current) => {
        const map = new Map(current.map((item) => [item.user.id, item]));
        remotePeers.forEach((item) => map.set(item.user.id, item));
        return Array.from(map.values());
      });
      remotePeers.forEach((item) => {
        if (item.user.id !== user.id) createPeer(item.user.id, true, socket);
      });
    };
    const onSignal = ({ channelId, from, payload }: { channelId: number; from: number; payload: unknown }) => {
      if (channelId !== channel.id || from === user.id || disposed) return;
      const peer = peers.current.get(from) || createPeer(from, false, socket);
      try { peer?.signal(payload as never); } catch (reason) { setError((reason as Error).message); }
    };
    const onInviteResponse = ({ channelId, accepted }: { channelId: number; accepted: boolean }) => {
      if (channelId === channel.id) setInviteStatus(accepted ? 'Приглашение принято' : 'Приглашение отклонено');
    };
    const onState = ({ channelId, participants: next }: { channelId: number; participants: VoiceMember[] }) => {
      if (channelId === channel.id && !disposed) setParticipants((current) => {
        if (next.length > current.length) playNexoSound('voice-user-join');
        if (next.length < current.length) playNexoSound('voice-user-leave');
        return next;
      });
    };
    const onLeft = ({ channelId, userId }: { channelId: number; userId: number }) => {
      if (channelId === channel.id) closePeer(userId);
    };
    socket.on('voice:peers', onPeers);
    socket.on('voice:signal', onSignal);
    socket.on('voice:state', onState);
    socket.on('voice:left', onLeft);
    socket.on('voice:invite-response', onInviteResponse);

    async function join() {
      try {
        const accessResponse = await apiFetch(`/api/servers/${server.id}/channels/${channel.id}/voice`);
        const accessPayload = await accessResponse.json().catch(() => ({}));
        if (!accessResponse.ok) throw new Error(accessPayload.message || 'У вас нет доступа к голосовому каналу.');
        if (!accessPayload.canConnect) throw new Error('У вас нет права подключаться к этому голосовому каналу.');
        const audio = await navigator.mediaDevices.getUserMedia({
          audio: audioInputId ? { deviceId: { exact: audioInputId }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true },
          video: false
        });
        if (disposed) { audio.getTracks().forEach((track) => track.stop()); return; }
        localRef.current = audio;
        setLocalStream(audio);
        const response = await apiFetch(`/api/servers/${server.id}/channels/${channel.id}/voice/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ muted: micMuted, deafened })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'Не удалось подключиться к голосовому каналу.');
        if (disposed) {
          await apiFetch(`/api/servers/${server.id}/channels/${channel.id}/voice/leave`, { method: 'POST' }).catch(() => {});
          return;
        }
        joinedRef.current = true;
        setJoinedAt(Date.now());
        setParticipants(payload.participants || []);
        playNexoSound('voice-join');
        socket.emit('channel:join', { serverId: server.id, channelId: channel.id });
        window.dispatchEvent(new CustomEvent('nexo-voice-state', { detail: {
          active: true, serverId: server.id, channelId: channel.id, serverName: server.name,
          channelName: channel.name, joinedAt: Date.now()
        } }));
      } catch (reason) {
        setError((reason as Error).message || 'Не удалось подключиться к голосовому каналу.');
        setBusy(false);
      } finally {
        if (!disposed) setBusy(false);
      }
    }
    void join();

    return () => {
      disposed = true;
      socket.off('voice:peers', onPeers);
      socket.off('voice:signal', onSignal);
      socket.off('voice:state', onState);
      socket.off('voice:left', onLeft);
      socket.off('voice:invite-response', onInviteResponse);
      peers.current.forEach((peer) => peer.destroy());
      peers.current.clear();
      localRef.current?.getTracks().forEach((track) => track.stop());
      screenRef.current?.getTracks().forEach((track) => track.stop());
      cameraRef.current?.getTracks().forEach((track) => track.stop());
      if (joinedRef.current) {
        playNexoSound('voice-leave');
        socket.emit('channel:leave', channel.id);
        void apiFetch(`/api/servers/${server.id}/channels/${channel.id}/voice/leave`, { method: 'POST' })
          .then((response) => response.json().catch(() => ({})))
          .then((payload) => window.dispatchEvent(new CustomEvent('nexo-voice-participants', { detail: { channelId: channel.id, participants: payload.participants || [] } })))
          .catch(() => {});
      }
      joinedRef.current = false;
      window.dispatchEvent(new CustomEvent('nexo-voice-state', { detail: { active: false, channelId: channel.id } }));
    };
  }, [server.id, server.name, channel.id, channel.name, user.id, createPeer, closePeer]);

  useEffect(() => {
    if (joinedRef.current) void updateVoiceState(micMuted, deafened);
  }, [micMuted, deafened]);

  async function openInvite() {
    setInviteOpen(true);
    setInviteStatus('');
    if (serverMembers.length) return;
    try {
      const response = await apiFetch(`/api/servers/${server.id}/members`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось загрузить участников.');
      setServerMembers(payload.members || []);
    } catch (reason) { setInviteStatus((reason as Error).message); }
  }

  function inviteMember(memberId: number) {
    getSocket().emit('voice:invite', { serverId: server.id, channelId: channel.id, to: memberId });
    setInviteStatus('Приглашение отправлено');
  }

  async function updateVoiceState(nextMuted: boolean, nextDeafened: boolean) {
    try {
      const response = await apiFetch(`/api/servers/${server.id}/channels/${channel.id}/voice/state`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted: nextMuted, deafened: nextDeafened })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось изменить настройки голоса.');
      setParticipants(payload.participants || []);
    } catch (reason) { setError((reason as Error).message); }
  }

  async function toggleScreenShare() {
    try {
      if (screenStream) {
        const old = screenStream;
        peers.current.forEach((peer) => old.getVideoTracks().forEach((track) => { try { peer.removeTrack(track, old); } catch {} }));
        old.getTracks().forEach((track) => track.stop());
        screenRef.current = null;
        setScreenStream(null);
        return;
      }
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenRef.current = display;
      setScreenStream(display);
      peers.current.forEach((peer) => display.getVideoTracks().forEach((track) => peer.addTrack(track, display)));
      display.getVideoTracks()[0]?.addEventListener('ended', () => {
        peers.current.forEach((peer) => display.getVideoTracks().forEach((track) => { try { peer.removeTrack(track, display); } catch {} }));
        screenRef.current = null;
        setScreenStream(null);
      }, { once: true });
    } catch (reason) { setError((reason as Error).message || 'Не удалось начать демонстрацию экрана.'); }
  }

  async function toggleCamera() {
    try {
      if (cameraStream) {
        const old = cameraStream;
        peers.current.forEach((peer) => old.getVideoTracks().forEach((track) => { try { peer.removeTrack(track, old); } catch {} }));
        old.getTracks().forEach((track) => track.stop());
        cameraRef.current = null;
        setCameraStream(null);
        return;
      }
      const camera = await navigator.mediaDevices.getUserMedia({ video: videoInputId ? { deviceId: { exact: videoInputId } } : true, audio: false });
      cameraRef.current = camera;
      setCameraStream(camera);
      peers.current.forEach((peer) => camera.getVideoTracks().forEach((track) => peer.addTrack(track, camera)));
      camera.getVideoTracks()[0]?.addEventListener('ended', () => {
        peers.current.forEach((peer) => camera.getVideoTracks().forEach((track) => { try { peer.removeTrack(track, camera); } catch {} }));
        cameraRef.current = null;
        setCameraStream(null);
      }, { once: true });
    } catch (reason) { setError((reason as Error).message || 'Не удалось включить камеру.'); }
  }

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId: number; action: string }>).detail;
      if (detail?.channelId !== channel.id) return;
      if (detail.action === 'camera') void toggleCamera();
      if (detail.action === 'screen') void toggleScreenShare();
      if (detail.action === 'leave') onLeave();
    };
    window.addEventListener('nexo-voice-action', onAction);
    return () => window.removeEventListener('nexo-voice-action', onAction);
  });

  const elapsed = joinedAt ? Math.max(0, Math.floor((clock - joinedAt) / 1000)) : 0;
  const duration = `${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;
  const visibleMembers = participants.length ? participants : [{ user: { id: user.id, username: user.username, display_name: user.display_name, avatar_url: user.avatar_url, avatar_color: user.avatar_color }, muted: micMuted, deafened, canSpeak: true, joined_at: new Date().toISOString() }];
  const localCanStream = participants.find((member) => member.user.id === user.id)?.canStream !== false;
  const localCanSpeak = participants.find((member) => member.user.id === user.id)?.canSpeak !== false;

  return (
    <div className="voice-room">
      <header className="voice-room-header">
        <div><span className="voice-room-indicator" /><div><strong>Голосовой · {channel.name}</strong><small>{server.name} · {duration}</small></div></div>
        <div className="voice-room-header-actions">
          <button type="button" className="voice-room-invite" onClick={() => void openInvite()}><UserPlus size={15} />Пригласить</button>
          <button type="button" className="voice-room-leave" onClick={onLeave} aria-label="Выйти из канала"><PhoneOff size={16} />Выйти</button>
        </div>
      </header>
      {error && <p className="voice-room-error">{error}</p>}
      {!localCanSpeak && <p className="voice-room-limit-note">У вас нет права говорить в этом канале. Микрофон отключён.</p>}
      {busy && <p className="voice-room-loading">Подключаемся к голосовому каналу…</p>}
      <div className={`voice-room-grid ${tileSize} ${screenStream || cameraStream || Object.values(remoteStreams).some((stream) => stream.getVideoTracks().length) ? 'has-video' : ''}`}>
        {visibleMembers.map((member) => {
          const remote = remoteStreams[member.user.id];
          const isLocal = member.user.id === user.id;
          const videoStream = isLocal ? (screenStream || cameraStream) : remote;
          const hasVideo = Boolean(videoStream?.getVideoTracks().length);
          return (
            <article key={member.user.id} className={`voice-member-tile ${((isLocal && speaking) || remoteSpeakingIds.includes(member.user.id)) ? 'speaking' : ''} ${member.muted || !member.canSpeak ? 'muted' : ''}`}>
              {hasVideo ? <video autoPlay playsInline muted={true} ref={(element) => { if (element && videoStream) element.srcObject = videoStream; }} /> : <Avatar user={member.user} size={76} />}
              <div className="voice-member-label"><strong>{isLocal ? 'Вы' : member.user.display_name || member.user.username}</strong>{(member.muted || !member.canSpeak) && <MicOff size={13} />}{member.deafened && <VolumeX size={13} />}</div>
            </article>
          );
        })}
      </div>
      {Object.entries(remoteStreams).map(([id, stream]) => <audio key={id} autoPlay ref={(element) => { if (element) { audioRefs.current[Number(id)] = element; element.srcObject = stream; element.muted = deafened; } }} />)}
      <footer className="voice-room-controls">
        <button type="button" className={micMuted ? 'is-off' : ''} onClick={onToggleMic} data-tooltip={micMuted ? 'Включить микрофон' : 'Выключить микрофон'}>{micMuted ? <MicOff /> : <Mic />}<span>Микрофон</span></button>
        <button type="button" className={deafened ? 'is-off' : ''} onClick={onToggleDeafen} data-tooltip={deafened ? 'Включить звук' : 'Выключить звук'}>{deafened ? <VolumeX /> : <Volume2 />}<span>Наушники</span></button>
        <button type="button" className={cameraStream ? 'is-on' : ''} onClick={() => void toggleCamera()} disabled={!localCanStream} title={localCanStream ? (cameraStream ? 'Выключить камеру' : 'Включить камеру') : 'Нет права передавать видео'}>{cameraStream ? <CameraOff /> : <Camera />}<span>Камера</span></button>
        <button type="button" className={screenStream ? 'is-on' : ''} onClick={() => void toggleScreenShare()} disabled={!localCanStream} title={localCanStream ? (screenStream ? 'Остановить демонстрацию' : 'Демонстрация экрана') : 'Нет права передавать экран'}><MonitorUp /><span>Экран</span></button>
        <div className="voice-room-more-wrap">
          <button type="button" className={moreOpen ? 'is-on' : ''} onClick={() => setMoreOpen((value) => !value)} title="Дополнительные настройки"><MoreHorizontal /><span>Ещё</span></button>
          {moreOpen && <div className="voice-room-more-popover">
            <div><span>Шумоподавление</span><Switch checked={noiseSuppression} onChange={setNoiseSuppression} label="Шумоподавление" /></div>
            <Slider label="Громкость участников" min={0} max={1} step={0.05} value={remoteVolume} valueLabel={`${Math.round(remoteVolume * 100)}%`} onChange={setRemoteVolume} />
            <label><span>Размер плитки</span><Select value={tileSize} onChange={(event) => setTileSize(event.target.value as typeof tileSize)}>
              <option value="compact">Компактный</option><option value="comfortable">Обычный</option><option value="large">Крупный</option>
            </Select></label>
          </div>}
        </div>
        <button type="button" className="voice-room-hangup" onClick={onLeave}><PhoneOff /><span>Выйти</span></button>
      </footer>
      {participants.length > 6 && <p className="voice-room-limit-note">Mesh-связь рассчитана на небольшие группы: комфортный предел — 5–6 участников.</p>}
      {inviteOpen && <div className="voice-invite-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setInviteOpen(false); }}>
        <section className="voice-invite-modal" role="dialog" aria-modal="true" aria-label="Пригласить в голосовой канал">
          <header><strong>Пригласить в голосовой канал</strong><button type="button" aria-label="Закрыть" onClick={() => setInviteOpen(false)}><X size={16} /></button></header>
          {inviteStatus && <p className="voice-invite-status">{inviteStatus}</p>}
          <div className="voice-invite-list">{serverMembers.filter((member) => member.id !== user.id).map((member) => <div key={member.id}>
            <Avatar user={member.user} size={30} /><span>{member.user.display_name || member.user.username}</span>
            <button type="button" onClick={() => inviteMember(member.id)}>Позвать</button>
          </div>)}</div>
        </section>
      </div>}
    </div>
  );
}

export default VoiceRoom;
