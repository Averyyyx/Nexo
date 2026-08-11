import { useState, useEffect } from 'react';
import type { FC } from 'react';
//import { motion, AnimatePresence } from 'framer-motion';
import type { FriendRecord, User, UserStatus } from '../../types';
import { apiFetch } from '../../lib/api';

// Определяем тип пользователя с правильным статусом
interface FriendUser extends Omit<User, 'status'> {
  status: UserStatus;  // 'online' | 'idle' | 'dnd' | 'invisible' | 'offline'
}

// Создаем расширенный тип для записей друзей
interface ExtendedFriendRecord extends Omit<FriendRecord, 'user'> {
  user: FriendUser;
}

// Пропсы компонента
interface FriendsListProps {
  onSelectFriend: (friend: FriendUser) => void;
}

export const FriendsList: FC<FriendsListProps> = ({ onSelectFriend }) => {
  const [friends, setFriends] = useState<ExtendedFriendRecord[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ExtendedFriendRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'online' | 'all' | 'pending'>('online');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadFriends();
  }, []);

  const loadFriends = async () => {
    try {
      const response = await apiFetch('/api/friends');
      if (response.ok) {
        const data: { friends: FriendRecord[]; pending: FriendRecord[] } = await response.json();
        setFriends(data.friends);
        setPendingRequests(data.pending);
      }
    } catch (error) {
      console.error('Failed to load friends:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAcceptRequest = async (requestId: number) => {
    try {
      const response = await apiFetch(`/api/friends/requests/${requestId}/accept`, {
        method: 'POST',
      });
      
      if (response.ok) {
        await loadFriends();
      }
    } catch (error) {
      console.error('Failed to accept friend request:', error);
    }
  };

  const handleRejectRequest = async (requestId: number) => {
    try {
      const response = await apiFetch(`/api/friends/requests/${requestId}/reject`, {
        method: 'POST',
      });
      
      if (response.ok) {
        await loadFriends();
      }
    } catch (error) {
      console.error('Failed to reject friend request:', error);
    }
  };

  const filteredFriends = friends.filter(friend => 
    friend.user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.user.display_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredRequests = pendingRequests.filter(request => 
    request.user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    request.user.display_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const onlineFriends = filteredFriends.filter(friend => friend.user.status === 'online');
  const displayFriends = activeTab === 'online' ? onlineFriends : filteredFriends;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-800 text-gray-200">
      <div className="p-4 border-b border-gray-700">
        <div className="relative">
          <input
            type="text"
            placeholder="Найти друзей"
            className="w-full bg-gray-700 rounded-md px-4 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <svg
            className="absolute right-3 top-2.5 h-4 w-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      <div className="flex border-b border-gray-700">
        <button
          className={`flex-1 py-3 text-sm font-medium ${
            activeTab === 'online' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => setActiveTab('online')}
        >
          В сети ({onlineFriends.length})
        </button>
        <button
          className={`flex-1 py-3 text-sm font-medium ${
            activeTab === 'all' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => setActiveTab('all')}
        >
          Все друзья ({friends.length})
        </button>
        <button
          className={`flex-1 py-3 text-sm font-medium ${
            activeTab === 'pending' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => setActiveTab('pending')}
        >
          В ожидании ({pendingRequests.length})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'pending' ? (
          <div className="divide-y divide-gray-700">
            {filteredRequests.length > 0 ? (
              filteredRequests.map((request) => (
                <div key={request.id} className="p-3 hover:bg-gray-700/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        <img
                          src={request.user.avatar_url || '/default-avatar.png'}
                          alt={request.user.username}
                          className="w-10 h-10 rounded-full"
                        />
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-gray-600 rounded-full border-2 border-gray-800"></div>
                      </div>
                      <div>
                        <div className="font-medium text-white">{request.user.display_name || request.user.username}</div>
                        <div className="text-xs text-gray-400">
                          {request.direction === 'incoming' ? 'Входящий запрос' : 'Исходящий запрос'}
                        </div>
                      </div>
                    </div>
                    {request.direction === 'incoming' && (
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleAcceptRequest(request.id)}
                          className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 transition-colors"
                        >
                          Принять
                        </button>
                        <button
                          onClick={() => handleRejectRequest(request.id)}
                          className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
                        >
                          Отклонить
                        </button>
                      </div>
                    )}
                    {request.direction === 'outgoing' && (
                      <span className="text-xs text-gray-400">Ожидание ответа</span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-gray-400">
                {searchQuery ? 'Запросы не найдены' : 'У вас нет ожидающих запросов'}
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {displayFriends.length > 0 ? (
              displayFriends.map((friend) => (
                <div
                  key={friend.id}
                  className="p-3 hover:bg-gray-700/50 transition-colors cursor-pointer"
                  onClick={() => onSelectFriend(friend.user)}
                >
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <img
                        src={friend.user.avatar_url || '/default-avatar.png'}
                        alt={friend.user.username}
                        className="w-10 h-10 rounded-full"
                      />
                      <div
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-800 ${
                          friend.user.status === 'online' ? 'bg-green-500' : 'bg-gray-600'
                        }`}
                      ></div>
                    </div>
                    <div>
                      <div className="font-medium text-white">
                        {friend.user.display_name || friend.user.username}
                      </div>
                      <div className="text-xs text-gray-400">
                        {friend.user.status === 'online' ? 'В сети' : 'Не в сети'}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-gray-400">
                {searchQuery ? 'Друзья не найдены' : 'У вас пока нет друзей'}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-gray-700">
        <button className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors">
          Добавить друга
        </button>
      </div>
    </div>
  );
};

export default FriendsList;
