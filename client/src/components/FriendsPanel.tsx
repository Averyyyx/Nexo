import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, UserPlus, X, MessageCircle, Search, Users, Clock3 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Avatar } from './Avatar';
import { Input } from './ui';
import type { FriendPayload, FriendRecord, User } from '../types';

type FriendsPanelProps = {
  user: User;
  onRefresh?: () => void;
  onOpenConversation?: (friend: Pick<User, 'username'>) => void;
};
type Status = { type: 'idle' | 'loading' | 'success' | 'error'; message?: string };
type FriendsView = 'online' | 'all' | 'pending' | 'add';
const emptyPayload: FriendPayload = { incoming: [], outgoing: [], friends: [] };

export function FriendsPanel({ user, onRefresh, onOpenConversation }: FriendsPanelProps) {
  const [handleQuery, setHandleQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [friends, setFriends] = useState<FriendPayload>(emptyPayload);
  const [status, setStatus] = useState<Status>({ type: 'idle' });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<FriendsView>('online');

  useEffect(() => {
    void refreshFriends();
    const socket = getSocket();
    const onUserUpdate = ({ user: updated }: { user: User }) => {
      setFriends((current) => ({
        incoming: current.incoming.map((item) => item.user.id === updated.id ? { ...item, user: updated } : item),
        outgoing: current.outgoing.map((item) => item.user.id === updated.id ? { ...item, user: updated } : item),
        friends: current.friends.map((item) => item.user.id === updated.id ? { ...item, user: updated } : item)
      }));
    };
    socket.on('user:update', onUserUpdate);
    return () => { socket.off('user:update', onUserUpdate); };
  }, []);

  async function refreshFriends() {
    setLoading(true);
    try {
      const response = await apiFetch('/api/friends');
      if (!response.ok) throw new Error('Не удалось загрузить список друзей.');
      setFriends(await response.json());
      onRefresh?.();
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    } finally { setLoading(false); }
  }

  async function handleAddFriend(event: FormEvent) {
    event.preventDefault();
    if (!handleQuery.trim()) return;
    setStatus({ type: 'loading', message: 'Отправляем запрос…' });
    try {
      const response = await apiFetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: handleQuery.trim().replace(/^@/, '') })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Не удалось отправить запрос.');
      }
      setHandleQuery('');
      setStatus({ type: 'success', message: 'Запрос отправлен.' });
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
        throw new Error(payload.message || 'Не удалось обновить запрос.');
      }
      await refreshFriends();
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  }

  const onlineFriends = useMemo(
    () => friends.friends.filter((record) => ['online', 'idle', 'dnd'].includes(record.user.status)),
    [friends.friends]
  );
  const shownFriends = (view === 'online' ? onlineFriends : friends.friends).filter((record) => {
    const name = (record.user.display_name || record.user.username).toLocaleLowerCase('ru-RU');
    return name.includes(searchQuery.trim().toLocaleLowerCase('ru-RU')) || record.user.username.toLowerCase().includes(searchQuery.trim().toLowerCase());
  });
  const title = view === 'online' ? 'В сети' : 'Все друзья';

  return (
    <div className="friends-panel discord-friends-page">
      <header className="discord-friends-toolbar">
        <div className="discord-friends-title"><Users size={20} /><strong>Друзья</strong></div>
        <nav className="discord-friends-tabs" aria-label="Разделы друзей">
          <button className={view === 'online' ? 'active' : ''} onClick={() => setView('online')}>В сети <span>{onlineFriends.length}</span></button>
          <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>Все <span>{friends.friends.length}</span></button>
          <button className={view === 'pending' ? 'active' : ''} onClick={() => setView('pending')}>Ожидание {friends.incoming.length > 0 && <b>{friends.incoming.length}</b>}</button>
          <button className={view === 'add' ? 'add-friend active' : 'add-friend'} onClick={() => { setView('add'); setStatus({ type: 'idle' }); }}>Добавить в друзья</button>
        </nav>
      </header>

      <div className="discord-friends-layout">
        <main className="discord-friends-main">
          {view !== 'add' && (
            <div className="friends-search">
              <Search size={17} />
              <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Поиск" aria-label="Поиск друзей" />
            </div>
          )}

          {status.message && <p className={`status ${status.type}`}>{status.message}</p>}

          <AnimatePresence mode="wait">
            {view === 'add' ? (
              <motion.section key="add" className="friends-add-panel" initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
                <span className="friends-add-icon"><UserPlus size={22} /></span>
                <h1>Добавить в друзья</h1>
                <p>Введите точный логин человека. Запрос появится у него в списке ожидания.</p>
                <form className="friends-add-form" onSubmit={handleAddFriend}>
                  <label htmlFor="friend-handle">Логин пользователя</label>
                  <div><Input id="friend-handle" value={handleQuery} onChange={(event) => setHandleQuery(event.target.value)}
                    placeholder="@username" required maxLength={25} autoFocus />
                    <button type="submit" className="primary" disabled={status.type === 'loading'}><UserPlus size={16} />Отправить запрос</button>
                  </div>
                </form>
              </motion.section>
            ) : view === 'pending' ? (
              <motion.section key="pending" className="friends-list-view" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
                <div className="friends-list-heading"><span>ВХОДЯЩИЕ ЗАПРОСЫ</span><b>{friends.incoming.length}</b></div>
                {friends.incoming.length === 0 && <div className="friends-empty"><Clock3 size={25} /><strong>Нет ожидающих запросов</strong><span>Новые запросы появятся здесь.</span></div>}
                {friends.incoming.map((record) => <FriendRow key={record.id} record={record} actions={<>
                  <button type="button" className="friend-accept" onClick={() => void handleRespond(record.id, 'accept')} title="Принять запрос"><Check size={16} /></button>
                  <button type="button" className="friend-decline" onClick={() => void handleRespond(record.id, 'decline')} title="Отклонить запрос"><X size={16} /></button>
                </>} />)}
                <div className="friends-list-heading outgoing"><span>ОТПРАВЛЕННЫЕ ЗАПРОСЫ</span><b>{friends.outgoing.length}</b></div>
                {friends.outgoing.length === 0 && <p className="friends-muted-line">Нет отправленных запросов.</p>}
                {friends.outgoing.map((record) => <FriendRow key={record.id} record={record} meta="Ожидает ответа" />)}
              </motion.section>
            ) : (
              <motion.section key={view} className="friends-list-view" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
                <div className="friends-list-heading"><span>{title.toUpperCase()}</span><b>{shownFriends.length}</b></div>
                {loading && <p className="friends-muted-line">Загружаем список…</p>}
                {!loading && shownFriends.length === 0 && (
                  <div className="friends-empty"><Users size={26} /><strong>{view === 'online' ? 'Сейчас никого нет в сети' : 'Здесь пока пусто'}</strong><span>{view === 'online' ? 'Когда друзья появятся в сети, они будут показаны здесь.' : 'Добавьте знакомых, чтобы начать общаться в Nexo.'}</span></div>
                )}
                {shownFriends.map((record) => <FriendRow key={record.id} record={record} actions={
                  <button type="button" className="friend-message" data-tooltip="Написать сообщение" aria-label="Написать сообщение"
                    onClick={() => onOpenConversation?.({ username: record.user.username })}><MessageCircle size={17} /></button>
                } />)}
              </motion.section>
            )}
          </AnimatePresence>
        </main>

        <aside className="discord-active-contacts">
          <h2>Активные контакты</h2>
          {onlineFriends.length === 0 ? <p>Пока никого нет в сети.</p> : onlineFriends.slice(0, 6).map((record) => (
            <button type="button" key={record.id} onClick={() => onOpenConversation?.({ username: record.user.username })}>
              <Avatar user={record.user} size={30} showStatus />
              <span><strong>{record.user.display_name || record.user.username}</strong><small>{record.user.custom_status || 'В сети'}</small></span>
            </button>
          ))}
          <div className="friends-self-handle"><span>ВАШ ЛОГИН</span><strong>@{user.username}</strong></div>
        </aside>
      </div>
    </div>
  );
}

function FriendRow({ record, actions, meta }: { record: FriendRecord; actions?: ReactNode; meta?: string }) {
  const name = record.user.display_name || record.user.username;
  const statusText = meta || record.user.custom_status || (record.user.status === 'online' ? 'В сети' : record.user.status === 'idle' ? 'Неактивен' : record.user.status === 'dnd' ? 'Не беспокоить' : 'Не в сети');
  return (
    <motion.article className={`discord-friend-row ${record.user.status}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} layout>
      <Avatar user={record.user} size={38} showStatus />
      <div className="discord-friend-identity"><strong>{name}</strong><small>{statusText}</small></div>
      {actions && <div className="discord-friend-actions">{actions}</div>}
    </motion.article>
  );
}
