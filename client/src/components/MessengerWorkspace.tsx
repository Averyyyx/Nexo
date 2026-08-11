import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import SimplePeer, { type SignalData } from 'simple-peer';
import {
  Hash,
  Headphones,
  Image as ImageIcon,
  Mic,
  Monitor,
  Paperclip,
  Phone,
  Plus,
  SendHorizontal,
  Settings,
  Users,
  Volume2,
  Cog
} from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { FriendsPanel } from './FriendsPanel';
import { SettingsPanel } from './SettingsPanel';
import type {
  Channel,
  ChannelMessage,
  Conversation,
  Message,
  Server,
  User
} from '../types';
import { apiFetch } from '../lib/api';
import { getSocket, disconnectSocket } from '../lib/socket';

type WorkspaceMode = 'servers' | 'friends';

type MessengerWorkspaceProps = {
  user: User;
};

type MessageStore = Record<number, Message[]>;
type ChannelMessageStore = Record<number, ChannelMessage[]>;

type CallState = {
  conversationId: number;
  peer: SimplePeer.Instance | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isScreenSharing: boolean;
  initiator: boolean;
};

type Status = { type: 'idle' | 'loading' | 'success' | 'error'; message?: string };

export function MessengerWorkspace({ user }: MessengerWorkspaceProps) {
  const [mode, setMode] = useState<WorkspaceMode>('servers');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messageStore, setMessageStore] = useState<MessageStore>({});
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const [servers, setServers] = useState<Server[]>([]);
  const [activeServerId, setActiveServerId] = useState<number | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [channelMessages, setChannelMessages] = useState<ChannelMessageStore>({});
  const [loadingChannelMessages, setLoadingChannelMessages] = useState(false);
  const [channelComposer, setChannelComposer] = useState('');
  const [channelUpload, setChannelUpload] = useState<File | null>(null);
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [serverModalStatus, setServerModalStatus] = useState<Status>({ type: 'idle' });

  const socketRef = useRef<Socket | null>(null);
  const [callState, setCallState] = useState<CallState | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const callStateRef = useRef<CallState | null>(null);
  const previousChannelRef = useRef<number | null>(null);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    fetchConversations();
    fetchServers();
  }, []);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    socketRef.current = socket;

    socket.on('socket:ready', () => {
      /* ready */
    });
    socket.on('conversation:upsert', ({ conversation }: { conversation: Conversation }) => {
      setConversations((prev) => {
        const exists = prev.find((item) => item.id === conversation.id);
        if (exists) {
          return prev.map((item) => (item.id === conversation.id ? conversation : item));
        }
        return [conversation, ...prev];
      });
    });
    socket.on('message:new', ({ conversationId, message }: { conversationId: number; message: Message }) => {
      setMessageStore((prev) => {
        const next = prev[conversationId] ? [...prev[conversationId], message] : [message];
        return { ...prev, [conversationId]: next };
      });
    });
    socket.on('message:ack', ({ conversationId, message }) => {
      setMessageStore((prev) => {
        const next = prev[conversationId] ? [...prev[conversationId], message] : [message];
        return { ...prev, [conversationId]: next };
      });
    });
    socket.on('call:signal', ({ conversationId, payload }: { conversationId: number; payload: SignalData }) => {
      handleIncomingSignal(conversationId, payload);
    });
    socket.on('call:end', ({ conversationId }: { conversationId: number }) => {
      if (callStateRef.current?.conversationId === conversationId) {
        endCall();
      }
    });
    socket.on('server:upsert', ({ server }: { server: Server }) => {
      setServers((prev) => {
        const exists = prev.find((item) => item.id === server.id);
        if (exists) {
          return prev.map((item) => (item.id === server.id ? server : item));
        }
        return [...prev, server].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      });
    });
    socket.on(
      'channel:message:new',
      ({ channelId, message }: { channelId: number; message: ChannelMessage }) => {
        setChannelMessages((prev) => {
          const next = prev[channelId] ? [...prev[channelId], message] : [message];
          return { ...prev, [channelId]: next };
        });
      }
    );
    socket.on('error', (payload) => {
      console.warn('Socket error', payload);
    });

    return () => {
      socket.off();
      disconnectSocket();
      socketRef.current = null;
    };
  }, [user]);

  useEffect(() => {
    if (!activeConversationId || !socketRef.current) return;
    socketRef.current.emit('conversation:join', activeConversationId);
    loadMessages(activeConversationId);
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeServerId || !socketRef.current) return;
    socketRef.current.emit('server:join', activeServerId);
  }, [activeServerId]);

  useEffect(() => {
    if (!socketRef.current || !activeChannelId || !activeServerId) return;
    const socket = socketRef.current;
    socket.emit('channel:join', { serverId: activeServerId, channelId: activeChannelId });
    loadChannelMessages(activeServerId, activeChannelId);
    const previousChannel = previousChannelRef.current;
    previousChannelRef.current = activeChannelId;
    return () => {
      if (previousChannel) {
        socket.emit('channel:leave', previousChannel);
      }
    };
  }, [activeServerId, activeChannelId]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) || null,
    [conversations, activeConversationId]
  );

  const activeMessages = activeConversationId ? messageStore[activeConversationId] || [] : [];
  const activeServer = useMemo(
    () => servers.find((server) => server.id === activeServerId) || null,
    [servers, activeServerId]
  );
  const activeChannel = useMemo(
    () => activeServer?.channels.find((channel) => channel.id === activeChannelId) || null,
    [activeServer, activeChannelId]
  );
  const activeChannelMessages = activeChannelId ? channelMessages[activeChannelId] || [] : [];

  useEffect(() => {
    if (!activeServer) {
      setActiveChannelId(null);
      return;
    }
    const channels = activeServer.channels || [];
    const currentExists = channels.some((channel) => channel.id === activeChannelId);
    if (currentExists) return;
    const firstText = channels.find((channel) => channel.type === 'text');
    setActiveChannelId(firstText?.id ?? null);
  }, [activeServer, activeChannelId]);

  async function fetchConversations() {
    try {
      const response = await apiFetch('/api/conversations');
      if (!response.ok) throw new Error('Failed to load conversations');
      const data = await response.json();
      setConversations(data.conversations || []);
      if (!activeConversationId && data.conversations?.length) {
        setActiveConversationId(data.conversations[0].id);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function fetchServers() {
    try {
      const response = await apiFetch('/api/servers');
      if (!response.ok) throw new Error('Failed to load servers');
      const data = await response.json();
      const next = (data.servers || []) as Server[];
      setServers(next);
      if (!activeServerId && next.length > 0) {
        setActiveServerId(next[0].id);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function loadMessages(conversationId: number) {
    setLoadingMessages(true);
    try {
      const response = await apiFetch(`/api/conversations/${conversationId}/messages`);
      if (!response.ok) throw new Error('Failed to load messages');
      const data = await response.json();
      setMessageStore((prev) => ({ ...prev, [conversationId]: data.messages || [] }));
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function loadChannelMessages(serverId: number, channelId: number) {
    setLoadingChannelMessages(true);
    try {
      const response = await apiFetch(`/api/servers/${serverId}/channels/${channelId}/messages`);
      if (!response.ok) throw new Error('Failed to load channel messages');
      const data = await response.json();
      setChannelMessages((prev) => ({ ...prev, [channelId]: data.messages || [] }));
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingChannelMessages(false);
    }
  }

  async function handleSendMessage() {
    if (!activeConversationId) return;
    if (!composerText.trim() && !uploadFile) return;

    const formData = new FormData();
    formData.append('content', composerText);
    if (uploadFile) {
      formData.append('attachment', uploadFile);
    }

    try {
      const response = await apiFetch(`/api/conversations/${activeConversationId}/messages`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Failed to send message');
      }
      const data = await response.json();
      setMessageStore((prev) => {
        const next = prev[activeConversationId]
          ? [...prev[activeConversationId], data.message]
          : [data.message];
        return { ...prev, [activeConversationId]: next };
      });
      setComposerText('');
      setUploadFile(null);
    } catch (error) {
      console.error(error);
    }
  }

  async function handleSendChannelMessage() {
    if (!activeServerId || !activeChannelId) return;
    if (!channelComposer.trim() && !channelUpload) return;

    const formData = new FormData();
    formData.append('content', channelComposer);
    if (channelUpload) {
      formData.append('attachment', channelUpload);
    }

    try {
      const response = await apiFetch(
        `/api/servers/${activeServerId}/channels/${activeChannelId}/messages`,
        {
          method: 'POST',
          body: formData
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Failed to send message');
      }
      const data = await response.json();
      setChannelMessages((prev) => {
        const next = prev[activeChannelId]
          ? [...prev[activeChannelId], data.message]
          : [data.message];
        return { ...prev, [activeChannelId]: next };
      });
      setChannelComposer('');
      setChannelUpload(null);
    } catch (error) {
      console.error(error);
    }
  }

  async function handleCreateServer(payload: { name: string; description: string }) {
    setServerModalStatus({ type: 'loading', message: 'Создаём сервер…' });
    try {
      const response = await apiFetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || 'Не удалось создать сервер');
      }
      const data = await response.json();
      setServerModalStatus({ type: 'success', message: 'Сервер готов' });
      setShowCreateServer(false);
      setServers((prev) => {
        const next = [...prev, data.server as Server];
        return next.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      });
      setActiveServerId(data.server.id);
    } catch (error) {
      setServerModalStatus({ type: 'error', message: (error as Error).message });
    }
  }

  async function startCall(conversationId: number, options?: { initiator?: boolean; initialSignal?: SignalData }) {
    if (!socketRef.current) return;
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      const peer = new SimplePeer({
        initiator: options?.initiator ?? true,
        trickle: false,
        stream: mediaStream
      });

      const state: CallState = {
        conversationId,
        peer,
        localStream: mediaStream,
        remoteStream: null,
        isScreenSharing: false,
        initiator: options?.initiator ?? true
      };
      callStateRef.current = state;
      setCallState(state);

      peer.on('signal', (payload) => {
        socketRef.current?.emit('call:signal', { conversationId, payload });
      });

      peer.on('stream', (remoteStream) => {
        callStateRef.current = callStateRef.current
          ? { ...callStateRef.current, remoteStream }
          : null;
        setCallState((prev) => (prev ? { ...prev, remoteStream } : prev));
      });

      peer.on('close', () => endCall());
      peer.on('error', (error) => {
        console.error(error);
        endCall();
      });

      if (options?.initialSignal) {
        peer.signal(options.initialSignal);
      }
    } catch (error) {
      console.error('Failed to start call', error);
    }
  }

  async function handleIncomingSignal(conversationId: number, payload: SignalData) {
    const current = callStateRef.current;
    if (!current) {
      await startCall(conversationId, { initiator: false, initialSignal: payload });
      return;
    }

    if (current.conversationId !== conversationId) {
      return;
    }

    current.peer?.signal(payload);
  }

  function endCall() {
    if (callStateRef.current?.peer) {
      callStateRef.current.peer.destroy();
    }
    callStateRef.current?.localStream?.getTracks().forEach((track) => track.stop());
    callStateRef.current?.remoteStream?.getTracks().forEach((track) => track.stop());
    callStateRef.current = null;
    setCallState(null);
    socketRef.current?.emit('call:end', { conversationId: activeConversationId });
  }

  async function shareScreen() {
    if (!callStateRef.current?.peer) return;
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      const localStream = callStateRef.current.localStream;
      const currentVideo = localStream?.getVideoTracks()[0];

      if (localStream && currentVideo) {
        localStream.removeTrack(currentVideo);
        localStream.addTrack(screenTrack);
        const peerWithReplace = callStateRef.current.peer as SimplePeer.Instance & {
          replaceTrack?: (oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack, stream: MediaStream) => void;
        };
        peerWithReplace?.replaceTrack?.(currentVideo, screenTrack, localStream);
        setCallState((prev) => (prev ? { ...prev, isScreenSharing: true } : prev));
        screenTrack.onended = () => {
          localStream.removeTrack(screenTrack);
          localStream.addTrack(currentVideo);
          peerWithReplace?.replaceTrack?.(screenTrack, currentVideo, localStream);
          setCallState((prev) => (prev ? { ...prev, isScreenSharing: false } : prev));
        };
      }
    } catch (error) {
      console.error('Share screen failed', error);
    }
  }

  function renderDirectMessages() {
    return (
      <div className="workspace-grid">
        <aside className="conversation-list">
          <header>
            <h3>
              <Users size={16} />
              Друзья
            </h3>
            <button className="ghost">Найти</button>
          </header>
          <div className="conversation-items">
            {conversations.length === 0 && <p className="muted">Нет диалогов — добавьте друзей.</p>}
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={`conversation-item ${conversation.id === activeConversationId ? 'active' : ''}`}
                onClick={() => setActiveConversationId(conversation.id)}
              >
                <div className="avatar">
                  {conversation.counterpart?.display_name?.[0]?.toUpperCase() ||
                    conversation.counterpart?.username?.[0]?.toUpperCase() ||
                    '#'}
                </div>
                <div>
                  <p>{conversation.title}</p>
                  <small>
                    {new Date(conversation.updated_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </small>
                </div>
              </button>
            ))}
          </div>
        </aside>
        <section className="chat-window">
          {!activeConversation && <p className="muted">Выберите диалог, чтобы начать общение.</p>}
          {activeConversation && (
            <>
              <header className="chat-header">
                <div className="title">
                  <Hash size={14} />
                  {activeConversation.title}
                </div>
                <div className="chat-actions">
                  <button className="ghost" onClick={() => startCall(activeConversation.id)}>
                    <Phone size={16} />
                    Позвонить
                  </button>
                  <button className="ghost" onClick={() => startCall(activeConversation.id, { initiator: true })}>
                    <Monitor size={16} />
                    Камера
                  </button>
                </div>
              </header>
              <div className="message-stream">
                {loadingMessages && <p className="muted">Загружаем…</p>}
                {!loadingMessages &&
                  activeMessages.map((message) => (
                    <article key={message.id} className="message-bubble">
                      <header>
                        <strong>{message.author.display_name || message.author.username}</strong>
                        <time>
                          {new Date(message.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </time>
                      </header>
                      {message.content && <p>{message.content}</p>}
                      {message.attachment && (
                        <AttachmentPreview attachment={message.attachment} />
                      )}
                    </article>
                  ))}
              </div>
              <div className="composer">
                <label className="file-pill">
                  <Paperclip size={16} />
                  <input
                    type="file"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) setUploadFile(file);
                    }}
                  />
                </label>
                <textarea
                  placeholder="Напишите сообщение..."
                  value={composerText}
                  onChange={(event) => setComposerText(event.target.value)}
                  rows={1}
                />
                <button className="primary tiny" onClick={handleSendMessage}>
                  <SendHorizontal size={16} />
                </button>
              </div>
              {uploadFile && (
                <div className="upload-preview">
                  <ImageIcon size={16} />
                  <span>{uploadFile.name}</span>
                  <button className="link" onClick={() => setUploadFile(null)}>
                    Удалить
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    );
  }

  function renderServerView() {
    if (servers.length === 0) {
      return (
        <div className="empty-state">
          <h2>Добро пожаловать в Vencord</h2>
          <p>Создайте свой первый сервер и соберите сообщество, как в полном Discord.</p>
          <button className="primary" onClick={() => setShowCreateServer(true)}>
            <Plus size={16} />
            Создать сервер
          </button>
        </div>
      );
    }

    return (
      <div className="workspace-grid servers">
        <section className="channel-column">
          {activeServer ? (
            <ServerSidebar
              server={activeServer}
              activeChannelId={activeChannelId}
              onSelectChannel={setActiveChannelId}
            />
          ) : (
            <div className="muted">Выберите сервер из списка слева.</div>
          )}
        </section>
        <section className="chat-window">
          {!activeChannel && <p className="muted">Выберите канал, чтобы начать общение.</p>}
          {activeChannel && (
            <>
              <header className="chat-header">
                <div className="title">
                  <Hash size={14} />
                  {activeChannel.name}
                  <small>{activeChannel.topic}</small>
                </div>
                <div className="chat-actions">
                  <button className="ghost">
                    <Users size={16} />
                    Участники
                  </button>
                  <button className="ghost">
                    <Settings size={16} />
                    Настройки
                  </button>
                </div>
              </header>
              <div className="message-stream">
                {loadingChannelMessages && <p className="muted">Загружаем…</p>}
                {!loadingChannelMessages &&
                  activeChannelMessages.map((message) => (
                    <article key={message.id} className="message-bubble">
                      <header>
                        <strong>{message.author.display_name || message.author.username}</strong>
                        <time>
                          {new Date(message.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </time>
                      </header>
                      {message.content && <p>{message.content}</p>}
                      {message.attachment && (
                        <AttachmentPreview attachment={message.attachment} />
                      )}
                    </article>
                  ))}
              </div>
              <div className="composer">
                <label className="file-pill">
                  <Paperclip size={16} />
                  <input
                    type="file"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) setChannelUpload(file);
                    }}
                  />
                </label>
                <textarea
                  placeholder={`Сообщение #${activeChannel.name}`}
                  value={channelComposer}
                  onChange={(event) => setChannelComposer(event.target.value)}
                  rows={1}
                />
                <button className="primary tiny" onClick={handleSendChannelMessage}>
                  <SendHorizontal size={16} />
                </button>
              </div>
              {channelUpload && (
                <div className="upload-preview">
                  <ImageIcon size={16} />
                  <span>{channelUpload.name}</span>
                  <button className="link" onClick={() => setChannelUpload(null)}>
                    Удалить
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="workspace-shell">
      <ServersRail
        mode={mode}
        servers={servers}
        activeServerId={mode === 'servers' ? activeServerId : null}
        onSelectHome={() => setMode('friends')}
        onSelectServer={(serverId) => {
          setMode('servers');
          setActiveServerId(serverId);
        }}
        onCreateServer={() => setShowCreateServer(true)}
        onOpenSettings={() => setShowSettings(true)}
      />
      <div className="workspace-main">
        <div className="workspace-nav">
          <button
            className={mode === 'servers' ? 'active' : ''}
            onClick={() => setMode('servers')}
          >
            Серверы
          </button>
          <button
            className={mode === 'friends' ? 'active' : ''}
            onClick={() => setMode('friends')}
          >
            Друзья
          </button>
        </div>
        {mode === 'friends' ? (
          <div className="friends-mode">
            <div className="friends-wrapper">
              <FriendsPanel
                user={user}
                onRefresh={() => {
                  fetchConversations();
                  fetchServers();
                }}
              />
            </div>
            {renderDirectMessages()}
          </div>
        ) : (
          renderServerView()
        )}
      </div>

      {callState && (
        <CallOverlay
          state={callState}
          onHangUp={endCall}
          onShareScreen={shareScreen}
        />
      )}

      {showCreateServer && (
        <CreateServerModal
          status={serverModalStatus}
          onClose={() => {
            setShowCreateServer(false);
            setServerModalStatus({ type: 'idle' });
          }}
          onSubmit={handleCreateServer}
        />
      )}

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function ServersRail({
  mode,
  servers,
  activeServerId,
  onSelectHome,
  onSelectServer,
  onCreateServer,
  onOpenSettings
}: {
  mode: WorkspaceMode;
  servers: Server[];
  activeServerId: number | null;
  onSelectHome: () => void;
  onSelectServer: (serverId: number) => void;
  onCreateServer: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside className="servers-rail">
      <button
        className={`server-circle home ${mode === 'friends' ? 'active' : ''}`}
        onClick={onSelectHome}
      >
        <Users size={18} />
      </button>
      {servers.map((server) => (
        <button
          key={server.id}
          className={`server-circle ${activeServerId === server.id ? 'active' : ''}`}
          onClick={() => onSelectServer(server.id)}
          title={server.name}
        >
          {server.icon ? (
            <img src={server.icon} alt={server.name} />
          ) : (
            (server.name[0] || '?').toUpperCase()
          )}
        </button>
      ))}
      <button className="server-circle ghost" onClick={onCreateServer}>
        <Plus size={18} />
      </button>
      <button className="server-circle ghost" onClick={onOpenSettings}>
        <Cog size={16} />
      </button>
    </aside>
  );
}

function ServerSidebar({
  server,
  activeChannelId,
  onSelectChannel
}: {
  server: Server;
  activeChannelId: number | null;
  onSelectChannel: (channelId: number) => void;
}) {
  const textChannels = server.channels.filter((channel) => channel.type === 'text');
  const voiceChannels = server.channels.filter((channel) => channel.type !== 'text');
  return (
    <>
      <div className="channel-header">
        {server.name}
        <button className="ghost-icon" title="Настройки сервера">
          <Settings size={16} />
        </button>
      </div>
      <div className="channel-group">
        <p className="group-title">текстовые</p>
        {textChannels.map((channel) => (
          <button
            key={channel.id}
            className={`channel ${activeChannelId === channel.id ? 'active' : ''}`}
            onClick={() => onSelectChannel(channel.id)}
          >
            <Hash size={14} />
            {channel.name}
          </button>
        ))}
        {textChannels.length === 0 && <p className="muted">Пока нет текстовых каналов.</p>}
      </div>
      <div className="channel-group">
        <p className="group-title">голосовые</p>
        {voiceChannels.map((channel) => (
          <button key={channel.id} className="channel voice">
            <Volume2 size={14} />
            {channel.name}
          </button>
        ))}
        {voiceChannels.length === 0 && <p className="muted">Добавьте голосовой канал.</p>}
      </div>
      <footer className="self-card">
        <div>
          <p>{server.role === 'owner' ? 'Вы — владелец' : 'Участник'}</p>
          <small>{server.description || 'Настройте сервер в любой момент'}</small>
        </div>
        <div className="controls">
          <button className="ghost-icon">
            <Mic size={16} />
          </button>
          <button className="ghost-icon">
            <Headphones size={16} />
          </button>
        </div>
      </footer>
    </>
  );
}

function AttachmentPreview({ attachment }: { attachment: Message['attachment'] | ChannelMessage['attachment'] }) {
  if (!attachment) return null;
  const isImage = attachment.mime.startsWith('image/');
  return (
    <div className="attachment-preview">
      {isImage ? (
        <img src={attachment.url} alt={attachment.name} />
      ) : (
        <a href={attachment.url} target="_blank" rel="noreferrer">
          {attachment.name}
        </a>
      )}
    </div>
  );
}

function CallOverlay({
  state,
  onHangUp,
  onShareScreen
}: {
  state: CallState;
  onHangUp: () => void;
  onShareScreen: () => void;
}) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && state.localStream) {
      localVideoRef.current.srcObject = state.localStream;
    }
  }, [state.localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && state.remoteStream) {
      remoteVideoRef.current.srcObject = state.remoteStream;
    }
  }, [state.remoteStream]);

  return (
    <motion.div
      className="call-overlay"
      initial={{ opacity: 0, y: 60 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
    >
      <div className="call-video remote">
        {state.remoteStream ? (
          <video ref={remoteVideoRef} autoPlay playsInline />
        ) : (
          <p>Ожидание подключения...</p>
        )}
      </div>
      <div className="call-video local">
        {state.localStream && <video ref={localVideoRef} autoPlay playsInline muted />}
      </div>
      <div className="call-controls">
        <button className="ghost" onClick={onShareScreen}>
          <Monitor size={18} />
          Трансляция
        </button>
        <button className="primary" onClick={onHangUp}>
          <Phone size={18} />
          Завершить
        </button>
      </div>
    </motion.div>
  );
}

function CreateServerModal({
  status,
  onClose,
  onSubmit
}: {
  status: Status;
  onClose: () => void;
  onSubmit: (payload: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (status.type === 'loading') return;
    onSubmit({ name, description });
  }

  return (
    <div className="modal-backdrop">
      <motion.div
        className="modal-panel"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
      >
        <header>
          <h2>Создать сервер</h2>
          <button className="ghost-icon" onClick={onClose}>
            ✕
          </button>
        </header>
        <p className="muted">Назовите пространство и добавьте короткое описание. Всё можно поменять позже.</p>
        <form className="modal-form" onSubmit={handleSubmit}>
          <label>
            <span>Название</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Например, Orbit Studio"
              minLength={3}
              maxLength={48}
              required
            />
          </label>
          <label>
            <span>Описание</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Для команды, сообщества или друзей."
              maxLength={240}
              rows={3}
            />
          </label>
          <button className="primary" type="submit" disabled={status.type === 'loading'}>
            {status.type === 'loading' ? 'Создаём…' : 'Запустить сервер'}
          </button>
          {status.message && <p className={`status ${status.type}`}>{status.message}</p>}
        </form>
      </motion.div>
    </div>
  );
}

