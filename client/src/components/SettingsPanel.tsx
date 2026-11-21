import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Palette,
  RefreshCw,
  UserCircle,
  Upload,
  Star,
  Users,
  Check,
  Layers,
  Hash,
  Volume2,
  Save,
  Trash2,
  LogOut,
  Keyboard
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { getNexoSoundPreferences, NEXO_SOUND_EVENTS, playNexoSound, saveNexoSoundPreferences, type NexoSoundPreferences } from '../lib/sounds';
import { Avatar } from './Avatar';
import { Field, Input, Select, Textarea, Switch, Slider, Button } from './ui';
import type { User, UserStatus } from '../types';
import { applyTheme, isThemeChoice } from '../lib/theme';
import { t } from '../lib/strings';
import type { Channel, Server, ServerRole } from '../types';

type SettingsSection = 'account' | 'profile' | 'appearance' | 'notifications' | 'voice' | 'hotkeys' | 'accessibility' | 'premium' | 'servers' | 'updates';

type SettingsPanelProps = {
  user: User;
  onUserUpdate?: (user: User) => void;
  initialSection?: SettingsSection;
  onClose: () => void;
  onLogout?: () => void;
  appVersion?: string;
  onCheckUpdates?: () => Promise<{ status: string; version?: string; message: string; releaseNotes?: string }>;
  audioInputId?: string;
  audioOutputId?: string;
  videoInputId?: string;
  onVideoInputChange?: (id: string) => void;
  onAudioInputChange?: (id: string) => void;
  onAudioOutputChange?: (id: string) => void;
};

type UserSettings = {
  theme: string;
  accent: string;
  background_url: string;
  reduce_motion: boolean;
  badges: string[];
};

type PremiumPlan = {
  id: number;
  slug: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  perks: string[];
};

type PremiumResponse = {
  brand: string;
  plans: PremiumPlan[];
};

type PremiumStatus = {
  active: boolean;
  plan: { id: number; name: string } | null;
  renews_at: string | null;
};

type TransactionResponse = {
  transaction: {
    id: number;
    plan_id: number;
    payment_intent: string;
    client_secret: string;
    amount_cents: number;
    currency: string;
  };
};

type Status = { type: 'idle' | 'loading' | 'success' | 'error'; message?: string };

const themeOptions = ['light', 'dark', 'system'] as const;
const themeLabels: Record<(typeof themeOptions)[number], string> = {
  light: t('themeLight'),
  dark: t('themeDark'),
  system: t('themeSystem')
};
const soundscapeThemes = ['', 'Aurora Pulse', 'Neon Drift', 'Forest Bloom', 'Retro Wave'];
const CHANNEL_OVERRIDE_FLAGS = [
  { label: 'Просмотр', value: 1 << 4 },
  { label: 'Сообщения', value: 1 << 5 },
  { label: 'Вход в голос', value: 1 << 7 },
  { label: 'Говорить', value: 1 << 8 }
];

const PERMISSION_FLAGS = [
  { label: 'Администратор', value: 1 << 0 },
  { label: 'Управление сервером', value: 1 << 1 },
  { label: 'Управление ролями', value: 1 << 2 },
  { label: 'Управление каналами', value: 1 << 3 },
  { label: 'Просмотр каналов', value: 1 << 4 },
  { label: 'Отправка сообщений', value: 1 << 5 },
  { label: 'Модерация сообщений', value: 1 << 6 },
  { label: 'Вход в голос', value: 1 << 7 },
  { label: 'Говорить', value: 1 << 8 },
  { label: 'Транслировать экран', value: 1 << 9 }
];

export function SettingsPanel({ user, onUserUpdate, initialSection = 'account', onClose, onLogout, appVersion = '0.0.8-alpha', onCheckUpdates, audioInputId = '', audioOutputId = '', videoInputId = '', onVideoInputChange, onAudioInputChange, onAudioOutputChange }: SettingsPanelProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [soundPreferences, setSoundPreferences] = useState<NexoSoundPreferences>(() => getNexoSoundPreferences());
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [accountName, setAccountName] = useState(user.display_name || '');
  const [accountHandle, setAccountHandle] = useState(user.username || '');
  const [profileBio, setProfileBio] = useState(user.bio || '');
  const [profileStatusChoice, setProfileStatusChoice] = useState<UserStatus>(user.status || 'online');
  const [profileCustomStatus, setProfileCustomStatus] = useState(user.custom_status || '');
  const [presenceBusy, setPresenceBusy] = useState(false);
  const [presenceStatus, setPresenceStatus] = useState<Status>({ type: 'idle' });
  const [profileColor, setProfileColor] = useState(user.avatar_color || '#D97757');
  const [profileAvatarPreset, setProfileAvatarPreset] = useState(user.avatar_preset ?? 0);
  const [handleState, setHandleState] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [handleHint, setHandleHint] = useState('Логин можно менять раз в 14 дней.');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileStatus, setProfileStatus] = useState<Status>({ type: 'idle' });
  const [passwordDraft, setPasswordDraft] = useState({ current: '', next: '', confirm: '' });
  const [passwordStatus, setPasswordStatus] = useState<Status>({ type: 'idle' });
  const [twoFactorQr, setTwoFactorQr] = useState('');
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [twoFactorStatus, setTwoFactorStatus] = useState<Status>({ type: 'idle' });
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ type: 'idle' });
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServerId, setActiveServerId] = useState<number | null>(null);
  const [serverDetail, setServerDetail] = useState<Server | null>(null);
  const [profileDraft, setProfileDraft] = useState({ name: '', description: '', icon: '' });
  const [roleDrafts, setRoleDrafts] = useState<Record<number, ServerRole>>({});
  const [channelDrafts, setChannelDrafts] = useState<Record<number, Channel>>({});
  const [serverStatus, setServerStatus] = useState<Status>({ type: 'idle' });
  const [roleStatus, setRoleStatus] = useState<Status>({ type: 'idle' });
  const [channelStatus, setChannelStatus] = useState<Status>({ type: 'idle' });
  const [premium, setPremium] = useState<PremiumResponse | null>(null);
  const [premiumStatus, setPremiumStatus] = useState<Status>({ type: 'idle' });
  const [updateStatus, setUpdateStatus] = useState<Status>({ type: 'idle' });
  const [autoDownloadUpdates, setAutoDownloadUpdates] = useState(true);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [releaseNotes, setReleaseNotes] = useState('');
  const [subscription, setSubscription] = useState<PremiumStatus | null>(null);
  const [overrideDrafts, setOverrideDrafts] = useState<
    Record<number, { roleId: number | ''; allow: number; deny: number }>
  >({});

  useEffect(() => {
    const refreshDevices = () => {
      void navigator.mediaDevices?.enumerateDevices?.().then((devices) => {
        setAudioInputs(devices.filter((device) => device.kind === 'audioinput'));
        setAudioOutputs(devices.filter((device) => device.kind === 'audiooutput'));
        setVideoInputs(devices.filter((device) => device.kind === 'videoinput'));
      }).catch(() => {});
    };
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
  }, []);

  useEffect(() => {
    if (settings?.reduce_motion) document.documentElement.dataset.reduceMotion = 'true';
    else delete document.documentElement.dataset.reduceMotion;
    return () => { delete document.documentElement.dataset.reduceMotion; };
  }, [settings?.reduce_motion]);

  useEffect(() => {
    window.nexoAPI?.getUpdatePreferences?.()
      .then((preferences) => setAutoDownloadUpdates(preferences.autoDownload !== false))
      .catch(() => {});
    const unsubscribe = window.nexoAPI?.onUpdateStatus?.((payload) => {
      if (Number.isFinite(payload.percent)) setUpdateProgress(payload.percent as number);
      if (payload.releaseNotes) setReleaseNotes(payload.releaseNotes);
      if (payload.status === 'checking' || payload.status === 'downloading' || payload.status === 'installing') {
        setUpdateStatus({ type: 'loading', message: payload.message || 'Проверяем обновление…' });
      } else if (payload.status === 'error') {
        setUpdateStatus({ type: 'error', message: payload.message || 'Не удалось выполнить обновление.' });
      } else if (payload.message) {
        setUpdateStatus({ type: 'success', message: payload.message });
      }
    });
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  useEffect(() => {
    const syncSoundPreferences = (event: Event) => {
      const next = (event as CustomEvent<NexoSoundPreferences>).detail;
      if (next) setSoundPreferences(next);
    };
    window.addEventListener('nexo-sound-preferences-updated', syncSoundPreferences);
    return () => window.removeEventListener('nexo-sound-preferences-updated', syncSoundPreferences);
  }, []);

  function changeSoundPreference<K extends keyof NexoSoundPreferences>(key: K, value: NexoSoundPreferences[K]) {
    setSoundPreferences((current) => {
      const next = { ...current, [key]: value };
      saveNexoSoundPreferences(next);
      return next;
    });
  }

  async function changeAutoDownload(value: boolean) {
    setAutoDownloadUpdates(value);
    try { window.nexoAPI?.setUpdatePreferences?.({ autoDownload: value }); }
    catch { setAutoDownloadUpdates(!value); }
  }

  useEffect(() => {
    setAccountName(user.display_name || '');
    setAccountHandle(user.username || '');
    setProfileBio(user.bio || '');
    setProfileColor(user.avatar_color || '#D97757');
    setProfileAvatarPreset(user.avatar_preset ?? 0);
  }, [user]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    async function bootstrap() {
      try {
        const response = await apiFetch('/api/settings/me');
        if (!response.ok) throw new Error('Не удалось загрузить настройки');
        const payload = await response.json();
        setSettings(payload.settings);
      } catch (error) {
        console.error(error);
      }
      await refreshServers();
      try {
        const response = await apiFetch('/api/premium/plans');
        if (response.ok) {
          const payload = (await response.json()) as PremiumResponse;
          setPremium(payload);
        }
        const statusResponse = await apiFetch('/api/premium/status');
        if (statusResponse.ok) {
          setSubscription((await statusResponse.json()) as PremiumStatus);
        }
      } catch (error) {
        console.error(error);
      }
    }
    bootstrap();
  }, []);

  useEffect(() => {
    if (!serverDetail) return;
    setProfileDraft({
      name: serverDetail.name,
      description: serverDetail.description,
      icon: serverDetail.icon
    });
    const nextRoles: Record<number, ServerRole> = {};
    serverDetail.roles.forEach((role) => (nextRoles[role.id] = { ...role }));
    const nextChannels: Record<number, Channel> = {};
    serverDetail.channels.forEach((channel) => (nextChannels[channel.id] = { ...channel }));
    setRoleDrafts(nextRoles);
    setChannelDrafts(nextChannels);
    const nextOverrides: Record<number, { roleId: number | ''; allow: number; deny: number }> = {};
    serverDetail.channels.forEach((channel) => {
      nextOverrides[channel.id] = { roleId: '', allow: 0, deny: 0 };
    });
    setOverrideDrafts(nextOverrides);
  }, [serverDetail]);

  async function refreshServers() {
    try {
      const response = await apiFetch('/api/servers');
      if (!response.ok) throw new Error('Не удалось загрузить сервера');
      const payload = await response.json();
      const items = (payload.servers || []) as Server[];
      setServers(items);
      if (!items.length) {
        setServerDetail(null);
        setActiveServerId(null);
        return;
      }
      const id = activeServerId ?? items[0].id;
      setActiveServerId(id);
      await loadServer(id);
    } catch (error) {
      console.error(error);
    }
  }

  async function loadServer(serverId: number) {
    try {
      const response = await apiFetch(`/api/servers/${serverId}`);
      if (!response.ok) throw new Error('Не удалось загрузить сервер');
      const payload = await response.json();
      setServerDetail(payload.server);
    } catch (error) {
      console.error(error);
      setServerDetail(null);
    }
  }

  async function saveAppearance(next: Partial<UserSettings>) {
    if (!settings) return;
    setSaving(true);
    setStatus({ type: 'idle' });
    try {
      const response = await apiFetch('/api/settings/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, ...next })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Ошибка сохранения');
      }
      const data = await response.json();
      setSettings(data.settings);
      const savedTheme = data.settings?.theme;
      if (isThemeChoice(savedTheme)) {
        applyTheme(savedTheme);
      }
      setStatus({ type: 'success', message: t('settingsSaved') });
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function updateServerProfile() {
    if (!serverDetail) return;
    setServerStatus({ type: 'loading', message: 'Сохраняем профиль...' });
    try {
      const response = await apiFetch(`/api/servers/${serverDetail.id}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileDraft)
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Не удалось обновить профиль');
      }
      await refreshServers();
      setServerStatus({ type: 'success', message: 'Профиль обновлён' });
    } catch (error) {
      setServerStatus({ type: 'error', message: (error as Error).message });
    }
  }

  function togglePermission(roleId: number, flag: number) {
    setRoleDrafts((prev) => {
      const role = prev[roleId];
      if (!role) return prev;
      return {
        ...prev,
        [roleId]: { ...role, permissions: role.permissions ^ flag }
      };
    });
  }

  async function saveRole(roleId: number) {
    if (!serverDetail) return;
    const draft = roleDrafts[roleId];
    if (!draft) return;
    setRoleStatus({ type: 'loading', message: 'Обновляем роль...' });
    try {
      const response = await apiFetch(`/api/servers/${serverDetail.id}/roles/${roleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          color: draft.color,
          permissions: draft.permissions,
          position: draft.position,
          is_default: draft.is_default
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Не удалось обновить роль');
      }
      await refreshServers();
      setRoleStatus({ type: 'success', message: 'Роль сохранена' });
    } catch (error) {
      setRoleStatus({ type: 'error', message: (error as Error).message });
    }
  }

  async function deleteRole(roleId: number) {
    if (!serverDetail) return;
    setRoleStatus({ type: 'loading', message: 'Удаляем роль...' });
    try {
      const response = await apiFetch(`/api/servers/${serverDetail.id}/roles/${roleId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Не удалось удалить роль');
      }
      await refreshServers();
      setRoleStatus({ type: 'success', message: 'Роль удалена' });
    } catch (error) {
      setRoleStatus({ type: 'error', message: (error as Error).message });
    }
  }

  async function createRole() {
    if (!serverDetail) return;
    setRoleStatus({ type: 'loading', message: 'Создаём роль...' });
    try {
      const response = await apiFetch(`/api/servers/${serverDetail.id}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Новая роль', color: '#8b5cf6', permissions: 0 })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Не удалось создать роль');
      }
      await refreshServers();
      setRoleStatus({ type: 'success', message: 'Роль создана' });
    } catch (error) {
      setRoleStatus({ type: 'error', message: (error as Error).message });
    }
  }

  function updateChannelDraft(channelId: number, patch: Partial<Channel>) {
    setChannelDrafts((prev) => ({
      ...prev,
      [channelId]: prev[channelId] ? { ...prev[channelId], ...patch } : prev[channelId]
    }));
  }

  function updateOverrideDraft(channelId: number, patch: Partial<{ roleId: number | ''; allow: number; deny: number }>) {
    setOverrideDrafts((prev) => ({
      ...prev,
      [channelId]: prev[channelId] ? { ...prev[channelId], ...patch } : { roleId: '', allow: 0, deny: 0, ...patch }
    }));
  }

  async function applyOverride(channelId: number) {
    if (!serverDetail) return;
    const draft = overrideDrafts[channelId];
    if (!draft || !draft.roleId) {
      setChannelStatus({ type: 'error', message: 'Выберите роль для override.' });
      return;
    }
    setChannelStatus({ type: 'loading', message: 'Обновляем права...' });
    try {
      const response = await apiFetch(`/api/servers/${serverDetail.id}/channels/${channelId}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'role',
          targetId: draft.roleId,
          allow: draft.allow,
          deny: draft.deny
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Не удалось обновить права');
      }
      await refreshServers();
      updateOverrideDraft(channelId, { allow: 0, deny: 0 });
      setChannelStatus({ type: 'success', message: 'Права обновлены' });
    } catch (error) {
      setChannelStatus({ type: 'error', message: (error as Error).message });
    }
  }

  async function removeOverride(channelId: number, targetId: number) {
    if (!serverDetail) return;
    setChannelStatus({ type: 'loading', message: 'Сбрасываем override...' });
    try {
      const response = await apiFetch(`/api/servers/${serverDetail.id}/channels/${channelId}/permissions`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'role', targetId })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Не удалось удалить override');
      }
      await refreshServers();
      setChannelStatus({ type: 'success', message: 'Override удалён' });
    } catch (error) {
      setChannelStatus({ type: 'error', message: (error as Error).message });
    }
  }

  async function saveChannel(channelId: number) {
    if (!serverDetail) return;
    const draft = channelDrafts[channelId];
    if (!draft) return;
    setChannelStatus({ type: 'loading', message: 'Сохраняем канал...' });
    try {
      const response = await apiFetch(`/api/servers/${serverDetail.id}/channels/${channelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: draft.topic,
          slow_mode_seconds: draft.slow_mode_seconds,
          is_nsfw: draft.is_nsfw,
          bitrate: draft.bitrate,
          user_limit: draft.user_limit,
          soundscape: draft.soundscape
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Не удалось обновить канал');
      }
      await refreshServers();
      setChannelStatus({ type: 'success', message: 'Канал обновлён' });
    } catch (error) {
      setChannelStatus({ type: 'error', message: (error as Error).message });
    }
  }

  async function purchasePlan(planId: number) {
    setPremiumStatus({ type: 'loading', message: `Создаём ${premium?.brand ?? 'Nexo Pulse'}…` });
    try {
      const response = await apiFetch('/api/premium/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Не удалось создать заказ');
      }
      const checkout = (await response.json()) as TransactionResponse;
      const confirm = await apiFetch('/api/premium/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: checkout.transaction.id })
      });
      if (!confirm.ok) {
        const payload = await confirm.json().catch(() => ({}));
        throw new Error(payload.message || 'Не удалось подтвердить');
      }
      setPremiumStatus({ type: 'success', message: `${premium?.brand ?? 'Nexo Pulse'} активирован!` });
      const statusResponse = await apiFetch('/api/premium/status');
      if (statusResponse.ok) {
        setSubscription((await statusResponse.json()) as PremiumStatus);
      }
    } catch (error) {
      setPremiumStatus({ type: 'error', message: (error as Error).message });
    }
  }

  function renderAppearance() {
    if (!settings) {
      return <p className="muted">Загружаем…</p>;
    }
    return (
      <div className="settings-section">
        <h2>Оформление</h2>
        <p className="muted">Тема интерфейса: светлая, тёмная или как в системе.</p>
        <div className="settings-group">
          <h3>Тема</h3>
          <div className="option-grid">
            {themeOptions.map((theme) => (
              <button
                key={theme}
                className={`option-card ${settings.theme === theme ? 'selected' : ''}`}
                onClick={() => saveAppearance({ theme })}
                disabled={saving}
              >
                <span className="swatch" data-theme={theme} />
                <strong>{themeLabels[theme]}</strong>
              </button>
            ))}
          </div>
        </div>
        <div className="settings-group">
          <label>
            <span>Фоновое изображение</span>
            <Input
              type="url"
              placeholder="https://example.com/wallpaper.png"
              value={settings.background_url}
              onChange={(event) =>
                setSettings((prev) => (prev ? { ...prev, background_url: event.target.value } : prev))
              }
              onBlur={() => saveAppearance({ background_url: settings.background_url })}
              disabled={saving}
            />
          </label>
        </div>
        <label className="toggle">
          <Input
            type="checkbox"
            checked={settings.reduce_motion}
            onChange={(event) => saveAppearance({ reduce_motion: event.target.checked })}
            disabled={saving}
          />
          <span>Уменьшить анимации</span>
        </label>
        {status.message && <p className={`status ${status.type}`}>{status.message}</p>}
      </div>
    );
  }

  function renderPremium() {
    if (!premium) {
      return <p className="muted">Загружаем Nexo Pulse…</p>;
    }
    return (
      <div className="settings-section">
        <h2>{premium.brand}</h2>
        {subscription?.active && (
          <p className="status success">
            Подписка активна{subscription.plan ? ` · ${subscription.plan.name}` : ''}
            {subscription.renews_at ? ` · до ${subscription.renews_at.slice(0, 10)}` : ''}
          </p>
        )}
        <p className="muted">
          Персонализируйте фон, получайте уникальные значки и поддерживайте сервера. Всё, как в Discord Nitro.
        </p>
        <div className="premium-grid">
          {premium.plans.map((plan) => (
            <article key={plan.id} className="premium-card">
              <header>
                <h3>{plan.name}</h3>
                <p className="muted">{plan.description}</p>
                <div className="price">
                  ${(plan.price_cents / 100).toFixed(2)}
                  <span>/мес</span>
                </div>
              </header>
              <ul>
                {plan.perks.map((perk) => (
                  <li key={perk}>
                    <Check size={16} />
                    {perk}
                  </li>
                ))}
              </ul>
              <button className="primary" onClick={() => purchasePlan(plan.id)} disabled={premiumStatus.type === 'loading' || Boolean(subscription?.active)}>
                {subscription?.active ? 'Уже активно' : 'Активировать'}
              </button>
            </article>
          ))}
        </div>
        {premiumStatus.message && <p className={`status ${premiumStatus.type}`}>{premiumStatus.message}</p>}
      </div>
    );
  }

  function renderRoles() {
    if (!serverDetail) return null;
    return (
      <section className="manager-card">
        <header>
          <Layers size={18} />
          <div>
            <h3>Роли и разрешения</h3>
            <p className="muted">Определите иерархию и доступ.</p>
          </div>
          <button className="ghost" onClick={createRole}>
            + Создать роль
          </button>
        </header>
        <div className="role-grid">
          {serverDetail.roles.map((role) => {
            const draft = roleDrafts[role.id] || role;
            return (
              <article key={role.id} className="role-card" style={{ borderColor: draft.color }}>
                <div className="role-header">
                  <Input
                    value={draft.name}
                    onChange={(event) =>
                      setRoleDrafts((prev) => ({ ...prev, [role.id]: { ...draft, name: event.target.value } }))
                    }
                  />
                  <Input
                    type="color"
                    value={draft.color}
                    onChange={(event) =>
                      setRoleDrafts((prev) => ({ ...prev, [role.id]: { ...draft, color: event.target.value } }))
                    }
                  />
                </div>
                <div className="permissions-grid">
                  {PERMISSION_FLAGS.map((flag) => (
                    <label key={`${role.id}-${flag.value}`}>
                      <Input
                        type="checkbox"
                        checked={Boolean(draft.permissions & flag.value)}
                        onChange={() => togglePermission(role.id, flag.value)}
                      />
                      {flag.label}
                    </label>
                  ))}
                </div>
                <div className="role-actions">
                  <button className="ghost" onClick={() => saveRole(role.id)}>
                    <Save size={14} />
                    Сохранить
                  </button>
                  {!role.is_default && (
                    <button className="ghost danger" onClick={() => deleteRole(role.id)}>
                      <Trash2 size={14} />
                      Удалить
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {roleStatus.message && <p className={`status ${roleStatus.type}`}>{roleStatus.message}</p>}
      </section>
    );
  }

  function renderChannels() {
    if (!serverDetail) return null;
    return (
      <section className="manager-card">
        <header>
          <Hash size={18} />
          <div>
            <h3>Каналы</h3>
            <p className="muted">Обновляйте slowmode, NSFW и уникальные Soundscapes.</p>
          </div>
        </header>
        <div className="channel-grid">
          {serverDetail.channels.map((channel) => {
            const draft = channelDrafts[channel.id] || channel;
            const isVoice = channel.type === 'voice';
            const liveChannel = serverDetail.channels.find((c) => c.id === channel.id);
            const overrides = liveChannel?.overrides || [];
            const overrideDraft = overrideDrafts[channel.id] || { roleId: '', allow: 0, deny: 0 };
            return (
              <article key={channel.id} className="channel-card">
                <header>
                  {isVoice ? <Volume2 size={16} /> : <Hash size={16} />}
                  <div>
                    <strong>#{channel.name}</strong>
                    <small>{channel.type}</small>
                  </div>
                </header>
                <label>
                  <span>Topic</span>
                  <Input
                    value={draft.topic || ''}
                    onChange={(event) => updateChannelDraft(channel.id, { topic: event.target.value })}
                  />
                </label>
                {!isVoice && (
                  <>
                    <label>
                      <span>Slow mode (сек)</span>
                      <Input
                        type="number"
                        min={0}
                        max={21600}
                        value={draft.slow_mode_seconds}
                        onChange={(event) =>
                          updateChannelDraft(channel.id, { slow_mode_seconds: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="toggle">
                      <Input
                        type="checkbox"
                        checked={draft.is_nsfw}
                        onChange={(event) => updateChannelDraft(channel.id, { is_nsfw: event.target.checked })}
                      />
                      NSFW
                    </label>
                  </>
                )}
                {isVoice && (
                  <>
                    <label>
                      <span>Bitrate</span>
                      <Input
                        type="number"
                        min={8000}
                        max={384000}
                        value={draft.bitrate}
                        onChange={(event) => updateChannelDraft(channel.id, { bitrate: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      <span>Лимит пользователей</span>
                      <Input
                        type="number"
                        min={0}
                        max={99}
                        value={draft.user_limit}
                        onChange={(event) => updateChannelDraft(channel.id, { user_limit: Number(event.target.value) })}
                      />
                    </label>
                  </>
                )}
                <label>
                  <span>Soundscape</span>
                  <Select
                    value={draft.soundscape || ''}
                    onChange={(event) => updateChannelDraft(channel.id, { soundscape: event.target.value })}
                  >
                    {soundscapeThemes.map((theme) => (
                      <option key={theme} value={theme}>
                        {theme || 'Выключено'}
                      </option>
                    ))}
                  </Select>
                </label>
                <button className="ghost" onClick={() => saveChannel(channel.id)}>
                  <Save size={14} />
                  Применить
                </button>
                <div className="override-section">
                  <strong>Переопределения</strong>
                  {overrides.length === 0 && <p className="muted small">Пока нет кастомных прав.</p>}
                  {overrides
                    .filter((override) => override.target_type === 'role')
                    .map((override) => {
                      const role = serverDetail.roles.find((role) => role.id === override.target_id);
                      const allowLabels = CHANNEL_OVERRIDE_FLAGS.filter((flag) => override.allow & flag.value).map(
                        (flag) => flag.label
                      );
                      const denyLabels = CHANNEL_OVERRIDE_FLAGS.filter((flag) => override.deny & flag.value).map(
                        (flag) => flag.label
                      );
                      return (
                        <div key={`${channel.id}-${override.target_id}`} className="override-row">
                          <div>
                            <strong>{role?.name || `Role ${override.target_id}`}</strong>
                            <small>
                              Allow: {allowLabels.length ? allowLabels.join(', ') : '—'} · Deny:{' '}
                              {denyLabels.length ? denyLabels.join(', ') : '—'}
                            </small>
                          </div>
                          <button className="ghost-icon" onClick={() => removeOverride(channel.id, override.target_id)}>
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  <div className="override-form">
                    <Select
                      value={overrideDraft.roleId || ''}
                      onChange={(event) =>
                        updateOverrideDraft(channel.id, {
                          roleId: event.target.value ? Number(event.target.value) : ''
                        })
                      }
                    >
                      <option value="">Роль…</option>
                      {serverDetail.roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </Select>
                    <div className="override-flag-grid">
                      {CHANNEL_OVERRIDE_FLAGS.map((flag) => (
                        <div key={`${channel.id}-allow-${flag.value}`}>
                          <label>
                            <Input
                              type="checkbox"
                              checked={Boolean(overrideDraft.allow & flag.value)}
                              onChange={() =>
                                updateOverrideDraft(channel.id, {
                                  allow: overrideDraft.allow ^ flag.value,
                                  deny: overrideDraft.deny & ~flag.value
                                })
                              }
                            />
                            Allow {flag.label}
                          </label>
                          <label>
                            <Input
                              type="checkbox"
                              checked={Boolean(overrideDraft.deny & flag.value)}
                              onChange={() =>
                                updateOverrideDraft(channel.id, {
                                  deny: overrideDraft.deny ^ flag.value,
                                  allow: overrideDraft.allow & ~flag.value
                                })
                              }
                            />
                            Deny {flag.label}
                          </label>
                        </div>
                      ))}
                    </div>
                    <button className="ghost tiny" onClick={() => applyOverride(channel.id)}>
                      Сохранить override
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {channelStatus.message && <p className={`status ${channelStatus.type}`}>{channelStatus.message}</p>}
      </section>
    );
  }

  function renderServerManager() {
    if (!servers.length) {
      return <p className="muted">Вы ещё не управляете серверами. Создайте сервер и настройте его здесь.</p>;
    }
    return (
      <div className="server-manager">
        <aside>
          {servers.map((server) => (
            <button
              key={server.id}
              className={`server-row ${activeServerId === server.id ? 'active' : ''}`}
              onClick={() => {
                setActiveServerId(server.id);
                loadServer(server.id);
              }}
            >
              <div>
                <strong>{server.name}</strong>
                <small>Роль: {server.role}</small>
              </div>
            </button>
          ))}
        </aside>
        <div className="server-config">
          {!serverDetail && <p className="muted">Выберите сервер слева, чтобы настроить.</p>}
          {serverDetail && (
            <>
              <section className="manager-card">
                <header>
                  <Users size={18} />
                  <div>
                    <h3>Профиль сервера</h3>
                    <p className="muted">Имя, описание, иконка</p>
                  </div>
                </header>
                <label>
                  <span>Название</span>
                  <Input value={profileDraft.name} onChange={(e) => setProfileDraft((prev) => ({ ...prev, name: e.target.value }))} />
                </label>
                <label>
                  <span>Описание</span>
                  <Textarea
                    rows={3}
                    value={profileDraft.description}
                    onChange={(e) => setProfileDraft((prev) => ({ ...prev, description: e.target.value }))}
                  />
                </label>
                <label>
                  <span>Иконка (URL)</span>
                  <Input value={profileDraft.icon} onChange={(e) => setProfileDraft((prev) => ({ ...prev, icon: e.target.value }))} />
                </label>
                <button className="ghost" onClick={updateServerProfile}>
                  <Save size={14} />
                  Сохранить профиль
                </button>
                {serverStatus.message && <p className={`status ${serverStatus.type}`}>{serverStatus.message}</p>}
              </section>
              {renderRoles()}
              {renderChannels()}
            </>
          )}
        </div>
      </div>
    );
  }

  function renderServers() {
    return (
      <div className="settings-section">
        <h2>Управление серверами</h2>
        <p className="muted">Настройте роли, каналы и фирменные звуковые сцены.</p>
        {renderServerManager()}
      </div>
    );
  }

  async function handleCheckUpdates() {
    if (!onCheckUpdates) {
      setUpdateStatus({ type: 'error', message: 'Проверка обновлений недоступна в этой сборке.' });
      return;
    }
    setUpdateStatus({ type: 'loading', message: 'Проверяем релизы Nexo…' });
    try {
      setUpdateProgress(null);
      const result = await onCheckUpdates();
      if (result.releaseNotes) setReleaseNotes(result.releaseNotes);
      setUpdateStatus({
        type: result.status === 'error' ? 'error' : result.status === 'unavailable' ? 'idle' : 'success',
        message: result.message
      });
    } catch (error) {
      setUpdateStatus({ type: 'error', message: (error as Error).message || 'Не удалось проверить обновления.' });
    }
  }

  function renderUpdates() {
    return (
      <div className="settings-section">
        <p className="eyebrow">NEXO DESKTOP</p>
        <h2>Обновления</h2>
        <p className="muted">Nexo проверяет новые Alpha-релизы автоматически при запуске. Здесь можно запустить проверку вручную.</p>
        <div className="update-version-card">
          <div><span>Установленная версия</span><strong>{appVersion}</strong></div>
          <span className="update-version-mark">ALPHA</span>
        </div>
        <button type="button" className="primary update-check-button" onClick={handleCheckUpdates}
          disabled={updateStatus.type === 'loading'}>
          <RefreshCw size={16} className={updateStatus.type === 'loading' ? 'spin' : ''} />
          {updateStatus.type === 'loading' ? 'Проверяем…' : 'Проверить обновления'}
        </button>
        {updateProgress !== null && updateStatus.type === 'loading' && (
          <div className="update-progress" aria-label={`Загрузка обновления: ${updateProgress}%`}>
            <div><span style={{ width: `${updateProgress}%` }} /></div><small>{updateProgress}%</small>
          </div>
        )}
        <label className="update-auto-download">
          <Input type="checkbox" checked={autoDownloadUpdates} onChange={(event) => void changeAutoDownload(event.target.checked)} />
          <span>Автоматически скачивать обновления</span>
        </label>
        {updateStatus.message && <p className={`status ${updateStatus.type}`}>{updateStatus.message}</p>}
        {releaseNotes && <details className="release-notes"><summary>Что нового</summary><pre>{releaseNotes}</pre></details>}
        <p className="muted update-help">При запуске Nexo проверяет новые Alpha-релизы. Скачанные установщики проверяются по SHA-256; тихая установка запускается автоматически.</p>
      </div>
    );
  }

  const profilePalette = ['#D97757', '#B66F83', '#788CB8', '#6F9B86', '#B18A55', '#897CB4', '#5F9EAA', '#9A806D', '#7E9670'];

  useEffect(() => {
    const value = accountHandle.trim().toLowerCase();
    if (!value || value === user.username) {
      setHandleState('available');
      setHandleHint(value === user.username ? 'Текущий логин.' : 'Введите логин.');
      return;
    }
    if (!/^[a-z0-9](?:[a-z0-9._-]{1,22}[a-z0-9])$/.test(value)) {
      setHandleState('taken');
      setHandleHint('3–24 символа; a–z, 0–9, точка, дефис или подчёркивание. Без спецсимвола в начале и конце.');
      return;
    }
    const timer = window.setTimeout(async () => {
      setHandleState('checking');
      try {
        const response = await apiFetch(`/api/profile/check-handle?username=${encodeURIComponent(value)}`);
        if (!response.ok) throw new Error('Не удалось проверить логин.');
        const payload = await response.json();
        setHandleState(payload.available ? 'available' : 'taken');
        setHandleHint(payload.available ? 'Свободен' : payload.reason || 'Уже занят');
      } catch {
        setHandleState('idle');
        setHandleHint('Не удалось проверить доступность. Сервер проверит логин при сохранении.');
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [accountHandle, user.username]);

  async function saveProfile() {
    if (accountName.trim().length < 2 || accountName.trim().length > 32) {
      setProfileStatus({ type: 'error', message: 'Имя должно содержать от 2 до 32 символов.' });
      return;
    }
    if (handleState === 'taken') {
      setProfileStatus({ type: 'error', message: handleHint });
      return;
    }
    setProfileBusy(true);
    setProfileStatus({ type: 'loading', message: 'Сохраняем изменения…' });
    try {
      const response = await apiFetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: accountName.trim(),
          username: accountHandle.trim().toLowerCase(),
          bio: profileBio.trim().slice(0, 200),
          avatarColor: profileColor,
          avatarPreset: profileAvatarPreset
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось сохранить профиль.');
      onUserUpdate?.(payload.user as User);
      setProfileStatus({ type: 'success', message: 'Профиль обновлён.' });
    } catch (error) {
      setProfileStatus({ type: 'error', message: (error as Error).message });
    } finally { setProfileBusy(false); }
  }

  async function uploadAvatar(file?: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setProfileStatus({ type: 'error', message: 'Изображение должно быть не больше 2 МБ.' });
      return;
    }
    setAvatarBusy(true);
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreview(previewUrl);
    try {
      const form = new FormData();
      form.append('avatar', file);
      const response = await apiFetch('/api/profile/avatar', { method: 'POST', body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось загрузить аватар.');
      onUserUpdate?.(payload.user as User);
      setProfileStatus({ type: 'success', message: 'Аватар обновлён.' });
    } catch (error) {
      setProfileStatus({ type: 'error', message: (error as Error).message });
    } finally {
      setAvatarBusy(false);
      setAvatarPreview(null);
      URL.revokeObjectURL(previewUrl);
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    try {
      const response = await apiFetch('/api/profile/avatar', { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось удалить аватар.');
      onUserUpdate?.(payload.user as User);
      setProfileStatus({ type: 'success', message: 'Аватар удалён.' });
    } catch (error) {
      setProfileStatus({ type: 'error', message: (error as Error).message });
    } finally { setAvatarBusy(false); }
  }

  async function updatePassword() {
    if (passwordDraft.next.length < 8 || passwordDraft.next.length > 128) {
      setPasswordStatus({ type: 'error', message: 'Пароль должен содержать от 8 до 128 символов.' });
      return;
    }
    if (passwordDraft.next !== passwordDraft.confirm) {
      setPasswordStatus({ type: 'error', message: 'Новые пароли не совпадают.' });
      return;
    }
    setPasswordStatus({ type: 'loading', message: 'Обновляем пароль…' });
    try {
      const response = await apiFetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: passwordDraft.current, newPassword: passwordDraft.next })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось изменить пароль.');
      setPasswordDraft({ current: '', next: '', confirm: '' });
      setPasswordStatus({ type: 'success', message: 'Пароль изменён.' });
    } catch (error) {
      setPasswordStatus({ type: 'error', message: (error as Error).message });
    }
  }

  async function startTwoFactor() {
    setTwoFactorStatus({ type: 'loading', message: 'Создаём QR-код…' });
    try {
      const response = await apiFetch('/api/auth/2fa/initiate', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось включить двухфакторную защиту.');
      setTwoFactorQr(payload.qr || '');
      setTwoFactorStatus({ type: 'idle', message: 'Отсканируйте QR-код в приложении-аутентификаторе и введите шестизначный код.' });
    } catch (error) {
      setTwoFactorStatus({ type: 'error', message: (error as Error).message });
    }
  }

  async function confirmTwoFactor(action: 'enable' | 'disable') {
    setTwoFactorStatus({ type: 'loading', message: 'Проверяем код…' });
    try {
      const response = await apiFetch(`/api/auth/2fa/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: twoFactorToken })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Неверный код.');
      if (payload.user) onUserUpdate?.(payload.user as User);
      setTwoFactorQr('');
      setTwoFactorToken('');
      setTwoFactorStatus({ type: 'success', message: action === 'enable' ? 'Двухфакторная защита включена.' : 'Двухфакторная защита выключена.' });
    } catch (error) {
      setTwoFactorStatus({ type: 'error', message: (error as Error).message });
    }
  }

  function renderAccount() {
    return (
      <div className="settings-section account-settings">
        <p className="eyebrow">АККАУНТ</p>
        <h2>Моя учётная запись</h2>
        <div className="account-identity">
          <Avatar user={user} size={64} showStatus />
          <div><strong>{user.display_name || user.username}</strong><small>@{user.username} · #{user.discriminator || '0001'}</small></div>
        </div>
        <div className="settings-group">
          <label><span>Email</span><Input value={user.email} readOnly disabled /></label>
          <small className="muted">Изменение адреса потребует подтверждения почты; почтовый сервис пока не подключён.</small>
        </div>
        <div className="settings-group">
          <h3>Изменить пароль</h3>
          <label><span>Текущий пароль</span><Input type="password" autoComplete="current-password" value={passwordDraft.current}
            onChange={(event) => setPasswordDraft((current) => ({ ...current, current: event.target.value }))} /></label>
          <label><span>Новый пароль</span><Input type="password" autoComplete="new-password" maxLength={128} value={passwordDraft.next}
            onChange={(event) => setPasswordDraft((current) => ({ ...current, next: event.target.value }))} /></label>
          <label><span>Повторите новый пароль</span><Input type="password" autoComplete="new-password" maxLength={128} value={passwordDraft.confirm}
            onChange={(event) => setPasswordDraft((current) => ({ ...current, confirm: event.target.value }))} /></label>
          <button type="button" className="primary" onClick={() => void updatePassword()}>Изменить пароль</button>
          {passwordStatus.message && <p className={`status ${passwordStatus.type}`}>{passwordStatus.message}</p>}
        </div>
        <div className="settings-group">
          <h3>Двухфакторная защита</h3>
          <p className="muted">{user.twofa_enabled ? 'Дополнительная проверка включена.' : 'Защитите аккаунт одноразовым кодом из приложения-аутентификатора.'}</p>
          {twoFactorQr && <img className="two-factor-qr" src={twoFactorQr} alt="QR-код для настройки двухфакторной защиты" />}
          {(!user.twofa_enabled || twoFactorQr) && <label><span>Шестизначный код</span><Input inputMode="numeric" maxLength={6} value={twoFactorToken}
            onChange={(event) => setTwoFactorToken(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>}
          {!user.twofa_enabled
            ? <button type="button" className="primary" onClick={() => twoFactorQr ? void confirmTwoFactor('enable') : void startTwoFactor()}>
                {twoFactorQr ? 'Подтвердить и включить' : 'Настроить 2FA'}
              </button>
            : <button type="button" className="ghost danger" onClick={() => void confirmTwoFactor('disable')}>Отключить 2FA</button>}
          {twoFactorStatus.message && <p className={`status ${twoFactorStatus.type}`}>{twoFactorStatus.message}</p>}
        </div>
        <div className="settings-group account-delete">
          <h3>Удаление аккаунта</h3>
          <p className="muted">Удаление аккаунта пока недоступно: сервер ещё не поддерживает безопасное удаление всех связанных сообщений и данных. Кнопка не показывается как рабочая.</p>
        </div>
      </div>
    );
  }

  async function savePresence() {
    setPresenceBusy(true);
    setPresenceStatus({ type: 'loading', message: 'Сохраняем статус…' });
    try {
      const response = await apiFetch('/api/profile/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: profileStatusChoice, customStatus: profileCustomStatus.trim().slice(0, 60) })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось сохранить статус.');
      onUserUpdate?.(payload.user);
      setPresenceStatus({ type: 'success', message: 'Статус сохранён' });
    } catch (error) {
      setPresenceStatus({ type: 'error', message: (error as Error).message });
    } finally {
      setPresenceBusy(false);
    }
  }

  function renderProfileSettings() {
    return (
      <div className="settings-section profile-settings">
        <p className="eyebrow">ПУБЛИЧНЫЙ ПРОФИЛЬ</p>
        <h2>Профиль</h2>
        <div className="profile-card-preview">
          <Avatar user={{ ...user, display_name: accountName, username: accountHandle, avatar_color: profileColor, avatar_preset: profileAvatarPreset, avatar_url: avatarPreview || (profileAvatarPreset !== (user.avatar_preset ?? 0) ? '' : user.avatar_url) }} size={58} />
          <div><strong>{accountName || 'Ваше имя'}</strong><small>@{accountHandle || 'username'} · #{user.discriminator || '0001'}</small>
            <p>{profileBio || 'Описание профиля пока пустое.'}</p></div>
        </div>
        <div className="settings-group">
          <h3>Статус</h3>
          <Field label="Состояние"><Select value={profileStatusChoice} onChange={(event) => setProfileStatusChoice(event.target.value as UserStatus)}>
              <option value="online">В сети</option><option value="idle">Отошёл</option><option value="dnd">Не беспокоить</option><option value="invisible">Невидимка</option>
            </Select></Field>
          <Field label="Свой статус"><Input value={profileCustomStatus} maxLength={60} placeholder="Над чем работаете?" onChange={(event) => setProfileCustomStatus(event.target.value)} /></Field>
          <small className="muted">{profileCustomStatus.length}/60</small>
          <button type="button" className="secondary" onClick={() => void savePresence()} disabled={presenceBusy}>
            {presenceBusy ? 'Сохраняем…' : 'Сохранить статус'}
          </button>
          {presenceStatus.message && <p className={`status ${presenceStatus.type}`}>{presenceStatus.message}</p>}
        </div>
        <div className="settings-group">
          <Field label="Отображаемое имя"><Input value={accountName} maxLength={32} onChange={(event) => setAccountName(event.target.value)} /></Field>
          <Field label="Логин @handle"><Input value={accountHandle} maxLength={24} onChange={(event) => setAccountHandle(event.target.value.toLowerCase())} /></Field>
          <small className={`handle-availability ${handleState}`}>{handleState === 'checking' ? 'Проверяем…' : handleHint}</small>
          <small className="muted">Логин можно менять раз в 14 дней. Отображаемое имя — не чаще одного раза в минуту.</small>
          <Field label="О себе"><Textarea value={profileBio} maxLength={200} rows={4} onChange={(event) => setProfileBio(event.target.value)} placeholder="Расскажите о себе…" /></Field>
          <small className="muted">{profileBio.length}/200</small>
        </div>
        <div className="settings-group">
          <h3>Аватар</h3>
          <div className="avatar-settings-row"><Avatar user={{ ...user, avatar_url: avatarPreview || user.avatar_url }} size={52} />
            <label className="file-upload-button"><Upload size={15} />Загрузить изображение
              <Input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={avatarBusy}
                onChange={(event) => { const file = event.target.files?.[0]; void uploadAvatar(file); event.currentTarget.value = ''; }} />
            </label>
            {user.avatar_url && <button type="button" className="ghost danger" onClick={() => void removeAvatar()} disabled={avatarBusy}>Удалить</button>}
          </div>
          <small className="muted">PNG, JPG или WebP, до 2 МБ. Сервер обрежет изображение и сохранит в WebP 256×256.</small>
        </div>
        <div className="settings-group">
          <h3>Цвет аватара</h3>
          <div className="avatar-color-options">{profilePalette.map((color) => <button key={color} type="button"
            className={profileColor === color ? 'selected' : ''} style={{ backgroundColor: color }}
            aria-label={`Цвет ${color}`} aria-pressed={profileColor === color} onClick={() => setProfileColor(color)} />)}</div>
        </div>
        <div className="settings-group">
          <h3>Аватары Nexo</h3>
          <p className="muted">Выберите одну из 12 геометрических эмблем. Загруженное изображение имеет приоритет.</p>
          <div className="avatar-preset-grid">
            {Array.from({ length: 12 }, (_, preset) => <button key={preset} type="button"
              className={profileAvatarPreset === preset ? 'selected' : ''}
              aria-label={`Аватар Nexo ${preset + 1}`} aria-pressed={profileAvatarPreset === preset}
              onClick={() => setProfileAvatarPreset(preset)}>
              <Avatar user={{ ...user, avatar_url: '', avatar_preset: preset }} size={42} />
            </button>)}
          </div>
        </div>
        <button type="button" className="primary" onClick={() => void saveProfile()} disabled={profileBusy || handleState === 'checking'}>
          {profileBusy ? 'Сохраняем…' : 'Сохранить профиль'}
        </button>
        {profileStatus.message && <p className={`status ${profileStatus.type}`}>{profileStatus.message}</p>}
      </div>
    );
  }

  function renderVoice() {
    return (
      <div className="settings-section discord-settings-page">
        <p className="eyebrow">ГОЛОС И ВИДЕО</p>
        <h2>Устройства</h2>
        <p className="muted">Выберите устройства, которые Nexo будет использовать для микрофона и вывода звука. Список обновляется при подключении или отключении оборудования.</p>
        <div className="settings-group voice-device-list">
          <div className="settings-device-row"><span><strong>Устройство ввода</strong><small>Микрофон для звонков</small></span>
            <Select value={audioInputId} onChange={(event) => onAudioInputChange?.(event.target.value)}><option value="">Системное устройство по умолчанию</option>{audioInputs.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Микрофон ${index + 1}`}</option>)}</Select>
          </div>
          <div className="settings-device-row"><span><strong>Устройство вывода</strong><small>Наушники или колонки для звонков</small></span>
            <Select value={audioOutputId} onChange={(event) => onAudioOutputChange?.(event.target.value)}><option value="">Системное устройство по умолчанию</option>{audioOutputs.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Устройство вывода ${index + 1}`}</option>)}</Select>
          </div>
          <div className="settings-device-row"><span><strong>Камера</strong><small>Устройство для видеозвонков и голосовых каналов</small></span>
            <Select value={videoInputId} onChange={(event) => onVideoInputChange?.(event.target.value)}><option value="">Системная камера по умолчанию</option>{videoInputs.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Камера ${index + 1}`}</option>)}</Select>
          </div>
        </div>
        <p className="muted">Названия устройств могут появиться только после предоставления разрешения на доступ к микрофону.</p>
      </div>
    );
  }

  function renderNotifications() {
    return (
      <div className="settings-section discord-settings-page">
        <p className="eyebrow">НАСТРОЙКИ ПРИЛОЖЕНИЯ</p>
        <h2>Уведомления и звуки</h2>
        <p className="muted">Единая звуковая палитра Nexo. Каждый сигнал можно отдельно отключить и прослушать.</p>
        <div className="settings-group sound-settings-list">
          <label className="settings-toggle-row"><span><strong>Все звуки</strong><small>Главный переключатель звуков Nexo</small></span>
            <Input type="checkbox" checked={soundPreferences.enabled} onChange={(event) => changeSoundPreference('enabled', event.target.checked)} /></label>
          <label className="settings-toggle-row"><span><strong>Разрешать звонки в режиме «Не беспокоить»</strong><small>Входящая мелодия будет звучать, если эта опция включена</small></span>
            <Input type="checkbox" checked={soundPreferences.allowCallsInDnd} onChange={(event) => changeSoundPreference('allowCallsInDnd', event.target.checked)} disabled={!soundPreferences.enabled} /></label>
        </div>
        <div className="settings-group sound-volume-list">
          <label className="sound-volume"><span><strong>Громкость звуков</strong><small>{Math.round(soundPreferences.volume * 100)}%</small></span>
            <Input type="range" min="0" max="1" step="0.02" value={soundPreferences.volume}
              onChange={(event) => changeSoundPreference('volume', Number(event.target.value))} disabled={!soundPreferences.enabled} /></label>
          <label className="sound-volume"><span><strong>Громкость мелодии звонка</strong><small>{Math.round(soundPreferences.ringtoneVolume * 100)}%</small></span>
            <Input type="range" min="0" max="1" step="0.02" value={soundPreferences.ringtoneVolume}
              onChange={(event) => changeSoundPreference('ringtoneVolume', Number(event.target.value))} disabled={!soundPreferences.enabled} /></label>
        </div>
        <div className="settings-group sound-event-list">
          {NEXO_SOUND_EVENTS.map((event) => (
            <div className="sound-event-row" key={event.key}>
              <span><strong>{event.label}</strong><small>{event.description}</small></span>
              <label className="sound-event-toggle" aria-label={`Включить звук: ${event.label}`}>
                <Input type="checkbox" checked={soundPreferences.events[event.key]}
                  onChange={(change) => changeSoundPreference('events', { ...soundPreferences.events, [event.key]: change.target.checked })}
                  disabled={!soundPreferences.enabled} />
              </label>
              <button type="button" className="ghost tiny" onClick={() => playNexoSound(event.key)} disabled={!soundPreferences.enabled || !soundPreferences.events[event.key]}>
                Прослушать
              </button>
            </div>
          ))}
        </div>
        <p className="muted">Первый сигнал может появиться после первого нажатия в приложении — это ограничение безопасности браузерного аудио.</p>
      </div>
    );
  }

  function renderAccessibility() {
    return (
      <div className="settings-section discord-settings-page">
        <p className="eyebrow">НАСТРОЙКИ ПРИЛОЖЕНИЯ</p>
        <h2>Специальные возможности</h2>
        <p className="muted">Управляйте движением интерфейса и визуальными эффектами.</p>
        {settings ? (
          <label className="settings-toggle-row"><span><strong>Уменьшить анимации</strong><small>Отключает декоративные переходы и анимацию появления элементов</small></span>
            <Input type="checkbox" checked={settings.reduce_motion} onChange={(event) => saveAppearance({ reduce_motion: event.target.checked })} disabled={saving} /></label>
        ) : <p className="muted">Загружаем настройки…</p>}
        {status.message && <p className={`status ${status.type}`}>{status.message}</p>}
      </div>
    );
  }

  function renderHotkeys() {
    const groups = [
      { title: 'РАБОЧЕЕ ПРОСТРАНСТВО', items: [
        ['Открыть быстрый поиск и команды', 'Ctrl', 'K'],
        ['Новое окно перехода / поиск диалога', 'Ctrl', 'T'],
        ['Закрыть текущую вкладку', 'Ctrl', 'W'],
        ['Восстановить закрытую вкладку', 'Ctrl + Shift', 'T'],
        ['Поиск по сообщениям', 'Ctrl', 'F'],
        ['Показать или скрыть боковую панель', 'Ctrl', 'B']
      ]},
      { title: 'ПЕРЕКЛЮЧЕНИЕ', items: [
        ['Следующая вкладка', 'Ctrl', 'Tab'],
        ['Предыдущая вкладка', 'Ctrl + Shift', 'Tab'],
        ['Перейти к вкладке 1–8', 'Ctrl', '1–8'],
        ['Перейти к последней вкладке', 'Ctrl', '9']
      ]},
      { title: 'КОМАНДНАЯ ПАЛИТРА', items: [
        ['Перемещение по результатам', '↑', '↓'],
        ['Выполнить выбранную команду', '', 'Enter'],
        ['Закрыть палитру', '', 'Esc']
      ]}
    ];
    return (
      <div className="settings-section discord-settings-page hotkeys-settings">
        <p className="eyebrow">НАСТРОЙКИ ПРИЛОЖЕНИЯ</p>
        <h2>Горячие клавиши</h2>
        <p className="muted">Быстро перемещайтесь по Nexo без мыши. На macOS сочетания используют Command вместо Ctrl.</p>
        {groups.map((group) => (
          <div className="settings-group" key={group.title}>
            <h3 className="settings-nav-group">{group.title}</h3>
            <div className="hotkey-list">
              {group.items.map(([label, modifier, key]) => (
                <div className="hotkey-row" key={label}>
                  <span>{label}</span>
                  <div>{modifier && <kbd>{modifier}</kbd>}<kbd>{key}</kbd></div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderSection() {
    switch (section) {
      case 'account': return renderAccount();
      case 'profile': return renderProfileSettings();
      case 'appearance':
        return renderAppearance();
      case 'notifications':
        return renderNotifications();
      case 'voice':
        return renderVoice();
      case 'hotkeys':
        return renderHotkeys();
      case 'accessibility':
        return renderAccessibility();
      case 'premium':
        return renderPremium();
      case 'servers':
        return renderServers();
      case 'updates':
        return renderUpdates();
      default:
        return (
          <div className="settings-section">
            <h2>Раздел не найден</h2>
            <p className="muted">Выберите раздел в навигации настроек.</p>
          </div>
        );
    }
  }

  return (
    <div className="settings-shell">
      <motion.aside className="settings-nav" initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
        <header>
          <h1>Настройки</h1>
          <p className="muted">Управляйте аккаунтом и внешним видом</p>
        </header>
        <nav>
          <button className={section === 'account' ? 'active' : ''} onClick={() => setSection('account')}><UserCircle size={16} />Моя учётная запись</button>
          <button className={section === 'profile' ? 'active' : ''} onClick={() => setSection('profile')}><Avatar user={user} size={16} />Профиль</button>
          <p className="settings-nav-group">Приложение</p>
          <button className={section === 'appearance' ? 'active' : ''} onClick={() => setSection('appearance')}>
            <Palette size={16} />Оформление
          </button>
          <button className={section === 'voice' ? 'active' : ''} onClick={() => setSection('voice')}>
            <Volume2 size={16} />Голос и видео
          </button>
          <button className={section === 'hotkeys' ? 'active' : ''} onClick={() => setSection('hotkeys')}>
            <Keyboard size={16} />Горячие клавиши
          </button>
          <button className={section === 'notifications' ? 'active' : ''} onClick={() => setSection('notifications')}>
            <Volume2 size={16} />Уведомления и звуки
          </button>
          <button className={section === 'accessibility' ? 'active' : ''} onClick={() => setSection('accessibility')}>
            <Check size={16} />Специальные возможности
          </button>
          <p className="settings-nav-group">Сообщества</p>
          <button className={section === 'premium' ? 'active' : ''} onClick={() => setSection('premium')}>
            <Star size={16} />
            Nexo Pulse
          </button>
          <button className={section === 'servers' ? 'active' : ''} onClick={() => setSection('servers')}>
            <Users size={16} />
            Серверы
          </button>
          <button className={section === 'updates' ? 'active' : ''} onClick={() => setSection('updates')}>
            <RefreshCw size={16} />
            Обновления
          </button>
        </nav>
        <div className="settings-nav-footer">
          {onLogout && <button className="settings-logout" onClick={onLogout}><LogOut size={16} />Выйти из аккаунта</button>}
          <button className="ghost" onClick={onClose}>Закрыть</button>
        </div>
      </motion.aside>
      <motion.section className="settings-content" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={section} initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .16 }}>
            {renderSection()}
          </motion.div>
        </AnimatePresence>
      </motion.section>
    </div>
  );
}

