import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { motion } from 'framer-motion';
import { apiFetch } from '../lib/api';
import type { User } from '../types';

type Status = { type: 'idle' | 'loading' | 'success' | 'error'; message?: string };

type ProfileSetupProps = {
  user: User;
  onComplete: (user: User) => void;
};

const normalizeHandle = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 24);

export function ProfileSetup({ user, onComplete }: ProfileSetupProps) {
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [handle, setHandle] = useState(
    user.profile_complete ? user.username : ''
  );
  const [status, setStatus] = useState<Status>({ type: 'idle' });

  const previewHandle = useMemo(() => {
    if (!handle) return 'ваше_имя';
    return handle;
  }, [handle]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus({ type: 'loading', message: 'Сохраняем профиль…' });
    try {
      const response = await apiFetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          username: normalizeHandle(handle)
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Не удалось обновить профиль');
      }

      const payload = await response.json();
      setStatus({ type: 'success', message: 'Профиль готов!' });
      onComplete(payload.user);
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  }

  function generateFromName() {
    const suggestion = normalizeHandle(displayName || user.email.split('@')[0]);
    setHandle(suggestion);
  }

  return (
    <div className="profile-panel">
      <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        Настройте присутствие
      </motion.h1>
      <p className="muted">
        Email подтверждён: <strong>{user.email}</strong>. Теперь выберите отображаемое имя и основной ник, по которому вас найдут друзья.
      </p>

      <form className="profile-form" onSubmit={handleSubmit}>
        <label>
          <span>Отображаемое имя</span>
          <input
            type="text"
            placeholder="Например, Лена из студии"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            minLength={2}
            maxLength={32}
            required
          />
        </label>

        <label>
          <span>Основной ник</span>
          <div className="handle-field">
            <input
              type="text"
              placeholder="vencord-wizard"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              minLength={3}
              maxLength={24}
              required
            />
            <button type="button" className="ghost" onClick={generateFromName}>
              Сгенерировать
            </button>
          </div>
          <small>Разрешены латинские буквы, цифры, точки, дефисы и подчёркивания.</small>
        </label>

        <div className="handle-preview">
          <span>Так вас найдут:</span>
          <strong>@{previewHandle}</strong>
        </div>

        <motion.button
          type="submit"
          className="primary"
          disabled={status.type === 'loading'}
          whileTap={{ scale: 0.98 }}
        >
          {status.type === 'loading' ? 'Сохраняем…' : 'Продолжить'}
        </motion.button>
      </form>

      <motion.p
        className={`status ${status.type}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: status.message ? 1 : 0.6, y: 0 }}
      >
        {status.message ||
          'Имя можно поменять позже в настройках. После сохранения откроется панель друзей.'}
      </motion.p>
    </div>
  );
}

