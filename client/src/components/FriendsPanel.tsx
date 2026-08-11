import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check, UserPlus, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { FriendPayload, FriendRecord, User } from '../types';

type FriendsPanelProps = {
  user: User;
  onRefresh?: () => void;
};

type Status = { type: 'idle' | 'loading' | 'success' | 'error'; message?: string };

const emptyPayload: FriendPayload = {
  incoming: [],
  outgoing: [],
  friends: []
};

export function FriendsPanel({ user, onRefresh }: FriendsPanelProps) {
  const [handleQuery, setHandleQuery] = useState('');
  const [friends, setFriends] = useState<FriendPayload>(emptyPayload);
  const [status, setStatus] = useState<Status>({ type: 'idle' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refreshFriends();
  }, []);

  async function refreshFriends() {
    setLoading(true);
    try {
      const response = await apiFetch('/api/friends');
      if (!response.ok) throw new Error('Не удалось загрузить друзей');
      const payload = await response.json();
      setFriends(payload);
      onRefresh?.();
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }

  async function handleAddFriend(event: FormEvent) {
    event.preventDefault();
    if (!handleQuery.trim()) return;
    setStatus({ type: 'loading', message: 'Отправляем запрос…' });
    try {
      const response = await apiFetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: handleQuery.trim() })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Не удалось отправить запрос');
      }
      setHandleQuery('');
      setStatus({ type: 'success', message: 'Запрос отправлен!' });
      await refreshFriends();
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  }

  async function handleRespond(requestId: number, action: 'accept' | 'decline') {
    try {
      const response = await apiFetch('/api/friends/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Не удалось обновить запрос');
      }
      await refreshFriends();
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  }

  return (
    <div className="friends-panel">
      <div className="panel-headline">
        <div>
          <p className="eyebrow">социальный граф</p>
          <h1>Добавьте друзей</h1>
        </div>
        <div className="self-handle">
          <span>ваш ник</span>
          <strong>@{user.username}</strong>
        </div>
      </div>

      <form className="friend-form" onSubmit={handleAddFriend}>
        <div>
          <label htmlFor="friend-handle">Добавить по нику</label>
          <p className="muted">Введите @ник друга и мы отправим запрос, как в Discord.</p>
        </div>
        <div className="friend-form-fields">
          <input
            id="friend-handle"
            value={handleQuery}
            onChange={(event) => setHandleQuery(event.target.value)}
            placeholder="например, orbit-designer"
            required
          />
          <button type="submit" className="primary" disabled={status.type === 'loading'}>
            <UserPlus size={16} />
            Отправить
          </button>
        </div>
      </form>

      {status.message && (
        <p className={`status ${status.type}`}>{status.message}</p>
      )}

      <section className="friend-section">
        <header>
          <h2>Входящие</h2>
          <span>{friends.incoming.length}</span>
        </header>
        <div className="friend-list">
          {friends.incoming.length === 0 && <p className="muted">Пока пусто.</p>}
          {friends.incoming.map((request) => (
            <FriendCard
              key={request.id}
              record={request}
              actions={
                <>
                  <button
                    type="button"
                    className="ghost-icon"
                    onClick={() => handleRespond(request.id, 'decline')}
                    aria-label="Отклонить"
                  >
                    <X size={16} />
                  </button>
                  <button
                    type="button"
                    className="ghost-icon"
                    onClick={() => handleRespond(request.id, 'accept')}
                    aria-label="Принять"
                  >
                    <Check size={16} />
                  </button>
                </>
              }
            />
          ))}
        </div>
      </section>

      <section className="friend-section">
        <header>
          <h2>Исходящие</h2>
          <span>{friends.outgoing.length}</span>
        </header>
        <div className="friend-list">
          {friends.outgoing.length === 0 && <p className="muted">Запросов нет.</p>}
          {friends.outgoing.map((request) => (
            <FriendCard key={request.id} record={request} />
          ))}
        </div>
      </section>

      <section className="friend-section">
        <header>
          <h2>Друзья</h2>
          <span>{friends.friends.length}</span>
        </header>
        <div className="friend-list">
          {loading && <p className="muted">Загружаем…</p>}
          {!loading && friends.friends.length === 0 && <p className="muted">Добавьте первых друзей.</p>}
          {friends.friends.map((friend) => (
            <FriendCard key={friend.id} record={friend} />
          ))}
        </div>
      </section>
    </div>
  );
}

function FriendCard({ record, actions }: { record: FriendRecord; actions?: ReactNode }) {
  return (
    <motion.article
      className={`friend-card ${record.status}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div>
        <p>{record.user.display_name || record.user.username}</p>
        <small>@{record.user.username}</small>
      </div>
      {actions && <div className="friend-actions">{actions}</div>}
    </motion.article>
  );
}

