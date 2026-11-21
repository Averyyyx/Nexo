export type SoundKind =
  | 'message' | 'send' | 'outgoing-ring' | 'ring'
  | 'call-accepted' | 'call-ended'
  | 'mic-on' | 'mic-off' | 'headphones-on' | 'headphones-off'
  | 'notification' | 'error' | 'voice-join' | 'voice-leave' | 'voice-user-join' | 'voice-user-leave';

export type NexoSoundPreferences = {
  enabled: boolean;
  volume: number;
  ringtoneVolume: number;
  allowCallsInDnd: boolean;
  events: Record<SoundKind, boolean>;
};

export const NEXO_SOUND_EVENTS: Array<{ key: SoundKind; label: string; description: string }> = [
  { key: 'message', label: 'Новое сообщение', description: 'Мягкая нисходящая пара нот' },
  { key: 'send', label: 'Отправка сообщения', description: 'Тихий короткий тон подтверждения' },
  { key: 'outgoing-ring', label: 'Исходящий вызов', description: 'Спокойный двойной сигнал во время вызова' },
  { key: 'ring', label: 'Входящий звонок', description: 'Оригинальная мелодия Nexo из пяти нот' },
  { key: 'call-accepted', label: 'Звонок принят', description: 'Короткая восходящая пара нот' },
  { key: 'call-ended', label: 'Звонок завершён', description: 'Мягкая нисходящая пара нот' },
  { key: 'mic-on', label: 'Микрофон включён', description: 'Сигнал включения микрофона' },
  { key: 'mic-off', label: 'Микрофон выключен', description: 'Сигнал выключения микрофона' },
  { key: 'headphones-on', label: 'Звук включён', description: 'Низкий сигнал включения вывода' },
  { key: 'headphones-off', label: 'Звук выключен', description: 'Низкий сигнал отключения вывода' },
  { key: 'notification', label: 'Уведомление и упоминание', description: 'Две ноты вверх' },
  { key: 'error', label: 'Ошибка', description: 'Один спокойный низкий тон' },
  { key: 'voice-join', label: 'Вход в голосовой канал', description: 'Короткая восходящая пара нот' },
  { key: 'voice-leave', label: 'Выход из голосового канала', description: 'Короткая нисходящая пара нот' },
  { key: 'voice-user-join', label: 'Участник подключился', description: 'Тихий сигнал появления участника' },
  { key: 'voice-user-leave', label: 'Участник отключился', description: 'Тихий сигнал выхода участника' }
];

const STORAGE_KEY = 'nexo.sound-preferences.v2';
const LEGACY_STORAGE_KEY = 'nexo.sound-preferences.v1';
const DEFAULT_EVENTS: Record<SoundKind, boolean> = {
  message: true, send: true, 'outgoing-ring': true, ring: true,
  'call-accepted': true, 'call-ended': true,
  'mic-on': true, 'mic-off': true, 'headphones-on': true, 'headphones-off': true,
  notification: true, error: true, 'voice-join': true, 'voice-leave': true,
  'voice-user-join': true, 'voice-user-leave': true
};
const DEFAULTS: NexoSoundPreferences = {
  enabled: true,
  volume: 0.22,
  ringtoneVolume: 0.25,
  allowCallsInDnd: false,
  events: DEFAULT_EVENTS
};

let audioContext: AudioContext | null = null;
let activeVoices = 0;
let unlockListenersInstalled = false;

function clampVolume(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

export function getNexoSoundPreferences(): NexoSoundPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || '{}';
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const legacyEvents: Record<SoundKind, boolean> = {
      ...DEFAULT_EVENTS,
      message: saved.messages !== false,
      ring: saved.calls !== false,
      'mic-on': saved.devices !== false,
      'mic-off': saved.devices !== false,
      'headphones-on': saved.devices !== false,
      'headphones-off': saved.devices !== false
    };
    const savedEvents = (saved.events && typeof saved.events === 'object')
      ? saved.events as Partial<Record<SoundKind, boolean>>
      : legacyEvents;
    return {
      enabled: saved.enabled !== false,
      volume: clampVolume(saved.volume, DEFAULTS.volume),
      ringtoneVolume: clampVolume(saved.ringtoneVolume, clampVolume(saved.volume, DEFAULTS.ringtoneVolume)),
      allowCallsInDnd: saved.allowCallsInDnd === true,
      events: Object.fromEntries(Object.keys(DEFAULT_EVENTS).map((key) => [
        key, savedEvents[key as SoundKind] !== false
      ])) as Record<SoundKind, boolean>
    };
  } catch {
    return { ...DEFAULTS, events: { ...DEFAULT_EVENTS } };
  }
}

export function saveNexoSoundPreferences(next: NexoSoundPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nexo-sound-preferences-updated', { detail: next }));
  } catch { /* Storage may be unavailable */ }
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Constructor = window.AudioContext;
  if (!Constructor) return null;
  if (!audioContext || audioContext.state === 'closed') audioContext = new Constructor();
  if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
  return audioContext;
}

function unlockAudio(): void {
  const audio = getAudioContext();
  if (audio?.state === 'suspended') void audio.resume().catch(() => {});
}

function installUnlockListeners(): void {
  if (typeof window === 'undefined' || unlockListenersInstalled) return;
  unlockListenersInstalled = true;
  window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
}

installUnlockListeners();

type SoundNote = { frequency: number; at: number; duration: number; gain: number; wave?: OscillatorType };

// All pitches belong to the C-major pentatonic family: C, D, E, G and A.
const C = 261.63, D = 293.66, E = 329.63, G = 392, A = 440, C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99;
const patterns: Record<SoundKind, SoundNote[]> = {
  message: [{ frequency: E5, at: 0, duration: .13, gain: .16 }, { frequency: C5, at: .15, duration: .16, gain: .13 }],
  send: [{ frequency: G, at: 0, duration: .075, gain: .075 }],
  'outgoing-ring': [{ frequency: C, at: 0, duration: .22, gain: .13 }, { frequency: E, at: .26, duration: .22, gain: .12 }],
  ring: [
    { frequency: C5, at: 0, duration: .28, gain: .2, wave: 'triangle' },
    { frequency: E5, at: .42, duration: .28, gain: .19, wave: 'triangle' },
    { frequency: G, at: .84, duration: .3, gain: .18, wave: 'triangle' },
    { frequency: E5, at: 1.26, duration: .28, gain: .18, wave: 'triangle' },
    { frequency: D5, at: 1.68, duration: .34, gain: .17, wave: 'triangle' }
  ],
  'call-accepted': [{ frequency: E, at: 0, duration: .12, gain: .14 }, { frequency: G, at: .15, duration: .16, gain: .14 }],
  'call-ended': [{ frequency: G, at: 0, duration: .13, gain: .13 }, { frequency: C, at: .16, duration: .18, gain: .12 }],
  'mic-on': [{ frequency: D, at: 0, duration: .1, gain: .12 }, { frequency: G, at: .12, duration: .12, gain: .13 }],
  'mic-off': [{ frequency: G, at: 0, duration: .1, gain: .12 }, { frequency: D, at: .12, duration: .12, gain: .12 }],
  'headphones-on': [{ frequency: C, at: 0, duration: .11, gain: .12 }, { frequency: E, at: .13, duration: .14, gain: .12 }],
  'headphones-off': [{ frequency: E, at: 0, duration: .11, gain: .11 }, { frequency: C, at: .13, duration: .14, gain: .11 }],
  notification: [{ frequency: G, at: 0, duration: .12, gain: .14 }, { frequency: C5, at: .15, duration: .16, gain: .15 }],
  error: [{ frequency: C, at: 0, duration: .2, gain: .13 }],
  'voice-join': [{ frequency: D, at: 0, duration: .1, gain: .11 }, { frequency: G, at: .12, duration: .13, gain: .12 }],
  'voice-leave': [{ frequency: G, at: 0, duration: .1, gain: .11 }, { frequency: D, at: .12, duration: .13, gain: .11 }],
  'voice-user-join': [{ frequency: E5, at: 0, duration: .09, gain: .08 }, { frequency: G5, at: .1, duration: .1, gain: .09 }],
  'voice-user-leave': [{ frequency: G5, at: 0, duration: .09, gain: .08 }, { frequency: E5, at: .1, duration: .1, gain: .08 }]
};

function scheduleSoundPattern(audio: AudioContext, kind: SoundKind, volume: number): void {
  for (const note of patterns[kind]) {
    window.setTimeout(() => {
      if (activeVoices >= 2 || audio.state !== 'running') return;
      const oscillator = audio.createOscillator();
      const filter = audio.createBiquadFilter();
      const gain = audio.createGain();
      const startAt = audio.currentTime;
      const stopAt = startAt + note.duration + .035;
      activeVoices += 1;
      oscillator.type = note.wave || 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, startAt);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1900, startAt);
      filter.Q.setValueAtTime(.55, startAt);
      gain.gain.setValueAtTime(.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume * note.gain), startAt + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, startAt + note.duration);
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(audio.destination);
      oscillator.onended = () => { activeVoices = Math.max(0, activeVoices - 1); };
      oscillator.start(startAt);
      oscillator.stop(stopAt);
    }, Math.round(note.at * 1000));
  }
}

export function playNexoSound(kind: SoundKind): void {
  const preferences = getNexoSoundPreferences();
  if (!preferences.enabled || !preferences.events[kind]) return;
  const isCallSound = kind === 'ring' || kind === 'outgoing-ring' || kind === 'call-accepted' || kind === 'call-ended';
  if (typeof document !== 'undefined' && document.documentElement.dataset.nexoDnd === 'true' && !(isCallSound && preferences.allowCallsInDnd)) return;
  const audio = getAudioContext();
  if (!audio) return;
  const volume = kind === 'ring' || kind === 'outgoing-ring'
    ? preferences.ringtoneVolume : preferences.volume;
  if (volume <= 0) return;
  if (audio.state === 'suspended') {
    void audio.resume().then(() => scheduleSoundPattern(audio, kind, volume)).catch(() => {});
    return;
  }
  if (audio.state === 'running') scheduleSoundPattern(audio, kind, volume);
}

export function startNexoRingtone(): () => void {
  const preferences = getNexoSoundPreferences();
  if (!preferences.enabled || !preferences.events.ring) return () => {};
  if (!preferences.allowCallsInDnd && typeof document !== 'undefined' && document.documentElement.dataset.nexoDnd === 'true') return () => {};
  let stopped = false;
  const play = () => { if (!stopped) playNexoSound('ring'); };
  play();
  const interval = window.setInterval(play, 4000);
  const timeout = window.setTimeout(stop, 45000);
  function stop() {
    if (stopped) return;
    stopped = true;
    window.clearInterval(interval);
    window.clearTimeout(timeout);
  }
  return stop;
}

export function startNexoOutgoingTone(): () => void {
  const preferences = getNexoSoundPreferences();
  if (!preferences.enabled || !preferences.events['outgoing-ring']) return () => {};
  if (!preferences.allowCallsInDnd && typeof document !== 'undefined' && document.documentElement.dataset.nexoDnd === 'true') return () => {};
  let stopped = false;
  const play = () => { if (!stopped) playNexoSound('outgoing-ring'); };
  play();
  const interval = window.setInterval(play, 3000);
  return () => { stopped = true; window.clearInterval(interval); };
}
