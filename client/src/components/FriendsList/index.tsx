import { useState, useEffect } from 'react';
import type { FC } from 'react';
import { Search, Users, UserRound, Check, X, MessageCircle } from 'lucide-react';
import type { FriendRecord, User, UserStatus } from '../../types';
import { apiFetch } from '../../lib/api';
import { Input } from '../ui';

interface FriendUser extends Omit<User, 'status'> { status: UserStatus; }
interface ExtendedFriendRecord extends Omit<FriendRecord, 'user'> { user: FriendUser; }
interface FriendsListProps { onSelectFriend: (friend: FriendUser) => void; }

export const FriendsList: FC<FriendsListProps> = ({ onSelectFriend }) => {
  const [friends, setFriends] = useState<ExtendedFriendRecord[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ExtendedFriendRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'online' | 'all' | 'pending'>('online');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [requestError, setRequestError] = useState('');

  useEffect(() => { void loadFriends(); }, []);

  const loadFriends = async () => {
    try {
      const response = await apiFetch('/api/friends');
      if (!response.ok) throw new Error('Не удалось загрузить список друзей');
      const data: { friends: FriendRecord[]; incoming?: FriendRecord[]; outgoing?: FriendRecord[]; pending?: FriendRecord[] } = await response.json();
      setFriends((data.friends || []) as ExtendedFriendRecord[]);
      const requests = data.pending || [...(data.incoming || []), ...(data.outgoing || [])];
      setPendingRequests(requests as ExtendedFriendRecord[]);
      setRequestError('');
    } catch (error) {
      console.error('Failed to load friends:', error);
      setRequestError((error as Error).message || 'Не удалось загрузить друзей');
    } finally { setIsLoading(false); }
  };

  const respondToRequest = async (requestId: number, action: 'accept' | 'reject') => {
    try {
      const response = await apiFetch('/api/friends/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, action: action === 'reject' ? 'decline' : 'accept' }) });
      if (!response.ok) throw new Error('Не удалось обновить запрос');
      await loadFriends();
    } catch (error) { setRequestError((error as Error).message); }
  };

  const query = searchQuery.trim().toLocaleLowerCase();
  const matches = (record: ExtendedFriendRecord) =>
    (record.user.username || '').toLocaleLowerCase().includes(query) ||
    (record.user.display_name || '').toLocaleLowerCase().includes(query);
  const filteredFriends = friends.filter(matches);
  const filteredRequests = pendingRequests.filter(matches);
  const onlineFriends = filteredFriends.filter((friend) => friend.user.status === 'online');
  const displayedFriends = activeTab === 'online' ? onlineFriends : filteredFriends;

  return (
    <section className="friends-quick-panel">
      <header className="friends-quick-header">
        <div className="friends-quick-title"><div className="friends-quick-icon"><Users size={17} /></div><div><h2>Друзья</h2><p>Ваши контакты</p></div></div>
        <span className="friends-total">{friends.length}</span>
      </header>
      <label className="friends-search">
        <Search size={15} />
        <Input type="search" placeholder="Поиск друзей" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} aria-label="Поиск друзей" />
        {searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label="Очистить поиск"><X size={14} /></button>}
      </label>
      <div className="friends-filter-tabs" role="tablist" aria-label="Фильтр друзей">
        <button type="button" role="tab" aria-selected={activeTab === 'online'} className={activeTab === 'online' ? 'active' : ''} onClick={() => setActiveTab('online')}>В сети <span>{onlineFriends.length}</span></button>
        <button type="button" role="tab" aria-selected={activeTab === 'all'} className={activeTab === 'all' ? 'active' : ''} onClick={() => setActiveTab('all')}>Все <span>{friends.length}</span></button>
        <button type="button" role="tab" aria-selected={activeTab === 'pending'} className={activeTab === 'pending' ? 'active' : ''} onClick={() => setActiveTab('pending')}>Запросы <span>{pendingRequests.length}</span></button>
      </div>
      <div className="friends-quick-list">
        {isLoading ? <div className="friends-quick-empty">Загружаем друзей…</div> : requestError ? (
          <div className="friends-quick-empty friends-quick-error">{requestError}<button type="button" onClick={() => { setIsLoading(true); void loadFriends(); }}>Повторить</button></div>
        ) : activeTab === 'pending' ? (
          filteredRequests.length ? filteredRequests.map((request) => (
            <article className="friends-quick-row" key={request.id}>
              <FriendAvatar record={request} />
              <div className="friends-quick-person"><strong>{request.user.display_name || request.user.username}</strong><span>@{request.user.username} · {request.direction === 'incoming' ? 'Входящий запрос' : 'Ожидает ответа'}</span></div>
              {request.direction === 'incoming' && <div className="friends-quick-actions">
                <button type="button" aria-label="Принять запрос" data-tooltip="Принять" onClick={() => void respondToRequest(request.id, 'accept')}><Check size={15} /></button>
                <button type="button" aria-label="Отклонить запрос" data-tooltip="Отклонить" onClick={() => void respondToRequest(request.id, 'reject')}><X size={15} /></button>
              </div>}
            </article>
          )) : <div className="friends-quick-empty">Нет ожидающих запросов</div>
        ) : displayedFriends.length ? displayedFriends.map((friend) => (
          <button type="button" className="friends-quick-row friends-quick-row-button" key={friend.id} onClick={() => onSelectFriend(friend.user)}>
            <FriendAvatar record={friend} />
            <span className="friends-quick-person"><strong>{friend.user.display_name || friend.user.username}</strong><span>@{friend.user.username}</span></span>
            <span className="friends-quick-open"><MessageCircle size={15} /></span>
          </button>
        )) : <div className="friends-quick-empty"><UserRound size={22} /><strong>{activeTab === 'online' ? 'Сейчас никого нет в сети' : 'Пока нет друзей'}</strong><span>{searchQuery ? 'Попробуйте изменить запрос поиска' : 'Добавьте друзей, чтобы начать общение'}</span></div>}
      </div>
    </section>
  );
};

function FriendAvatar({ record }: { record: ExtendedFriendRecord }) {
  const name = record.user.display_name || record.user.username || 'N';
  return <span className="friends-quick-avatar">{record.user.avatar_url ? <img src={record.user.avatar_url} alt="" /> : name.slice(0, 1).toUpperCase()}<i className={record.user.status === 'online' ? 'online' : ''} /></span>;
}

export default FriendsList;
