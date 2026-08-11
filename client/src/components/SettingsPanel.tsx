import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Shield,
  Palette,
  CreditCard,
  Star,
  Users,
  Check,
  Layers,
  Hash,
  Volume2,
  Save,
  Trash2
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Channel, Server, ServerRole } from '../types';

type SettingsSection = 'appearance' | 'privacy' | 'notifications' | 'premium' | 'servers';

type SettingsPanelProps = {
  onClose: () => void;
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

const themeOptions = ['nebula', 'midnight', 'lilac', 'onyx', 'solstice'] as const;
const accentOptions = ['violet', 'teal', 'amber', 'rose', 'sky'] as const;
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

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [section, setSection] = useState<SettingsSection>('appearance');
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
  const [overrideDrafts, setOverrideDrafts] = useState<
    Record<number, { roleId: number | ''; allow: number; deny: number }>
  >({});

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
      setStatus({ type: 'success', message: 'Обновлено' });
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
    setPremiumStatus({ type: 'loading', message: 'Создаём Vencord Pulse…' });
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
      setPremiumStatus({ type: 'success', message: 'Vencord Pulse активирован!' });
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
        <p className="muted">Темы, акценты, фоны. Всё, что делает Vencord узнаваемым.</p>
        <div className="settings-group">
          <h3>Темы</h3>
          <div className="option-grid">
            {themeOptions.map((theme) => (
              <button
                key={theme}
                className={`option-card ${settings.theme === theme ? 'selected' : ''}`}
                onClick={() => saveAppearance({ theme })}
                disabled={saving}
              >
                <span className="swatch" data-theme={theme} />
                <strong>{theme}</strong>
              </button>
            ))}
          </div>
        </div>
        <div className="settings-group">
          <h3>Акцент</h3>
          <div className="option-grid">
            {accentOptions.map((accent) => (
              <button
                key={accent}
                className={`option-pill ${settings.accent === accent ? 'selected' : ''}`}
                onClick={() => saveAppearance({ accent })}
                disabled={saving}
              >
                <span className="dot" data-accent={accent} />
                {accent}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-group">
          <label>
            <span>Фоновое изображение</span>
            <input
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
          <input
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
      return <p className="muted">Загружаем Vencord Pulse…</p>;
    }
    return (
      <div className="settings-section">
        <h2>{premium.brand}</h2>
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
              <button className="primary" onClick={() => purchasePlan(plan.id)} disabled={premiumStatus.type === 'loading'}>
                Активировать
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
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      setRoleDrafts((prev) => ({ ...prev, [role.id]: { ...draft, name: event.target.value } }))
                    }
                  />
                  <input
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
                      <input
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
                  <input
                    value={draft.topic || ''}
                    onChange={(event) => updateChannelDraft(channel.id, { topic: event.target.value })}
                  />
                </label>
                {!isVoice && (
                  <>
                    <label>
                      <span>Slow mode (сек)</span>
                      <input
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
                      <input
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
                      <input
                        type="number"
                        min={8000}
                        max={384000}
                        value={draft.bitrate}
                        onChange={(event) => updateChannelDraft(channel.id, { bitrate: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      <span>Лимит пользователей</span>
                      <input
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
                  <select
                    value={draft.soundscape || ''}
                    onChange={(event) => updateChannelDraft(channel.id, { soundscape: event.target.value })}
                  >
                    {soundscapeThemes.map((theme) => (
                      <option key={theme} value={theme}>
                        {theme || 'Выключено'}
                      </option>
                    ))}
                  </select>
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
                    <select
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
                    </select>
                    <div className="override-flag-grid">
                      {CHANNEL_OVERRIDE_FLAGS.map((flag) => (
                        <div key={`${channel.id}-allow-${flag.value}`}>
                          <label>
                            <input
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
                            <input
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
                  <input value={profileDraft.name} onChange={(e) => setProfileDraft((prev) => ({ ...prev, name: e.target.value }))} />
                </label>
                <label>
                  <span>Описание</span>
                  <textarea
                    rows={3}
                    value={profileDraft.description}
                    onChange={(e) => setProfileDraft((prev) => ({ ...prev, description: e.target.value }))}
                  />
                </label>
                <label>
                  <span>Иконка (URL)</span>
                  <input value={profileDraft.icon} onChange={(e) => setProfileDraft((prev) => ({ ...prev, icon: e.target.value }))} />
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

  function renderSection() {
    switch (section) {
      case 'appearance':
        return renderAppearance();
      case 'premium':
        return renderPremium();
      case 'servers':
        return renderServers();
      default:
        return (
          <div className="settings-section">
            <h2>Раздел скоро появится</h2>
            <p className="muted">Уведомления, безопасность и приватность будут добавлены позже.</p>
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
          <button className={section === 'appearance' ? 'active' : ''} onClick={() => setSection('appearance')}>
            <Palette size={16} />
            Оформление
          </button>
          <button className={section === 'premium' ? 'active' : ''} onClick={() => setSection('premium')}>
            <Star size={16} />
            Vencord Pulse
          </button>
          <button className={section === 'servers' ? 'active' : ''} onClick={() => setSection('servers')}>
            <Users size={16} />
            Серверы
          </button>
          <button className={section === 'privacy' ? 'active' : ''} onClick={() => setSection('privacy')}>
            <Shield size={16} />
            Приватность
          </button>
          <button className={section === 'notifications' ? 'active' : ''} onClick={() => setSection('notifications')}>
            <CreditCard size={16} />
            Уведомления
          </button>
        </nav>
        <button className="ghost" onClick={onClose}>
          Закрыть
        </button>
      </motion.aside>
      <motion.section className="settings-content" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}>
        {renderSection()}
      </motion.section>
    </div>
  );
}

