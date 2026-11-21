import { type FormEvent, type ReactNode, type MouseEvent as ReactMouseEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import SimplePeer, { type SignalData } from 'simple-peer';
import {
  Hash,
  Image as ImageIcon,
  Code,
  Copy,
  Search,
  Link as LinkIcon,
  Monitor,
  Paperclip,
  Pencil,
  Pin,
  Phone,
  PhoneOff,
  Camera,
  CameraOff,
  ChevronUp,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Mic,
  MicOff,
  Plus,
  SendHorizontal,
  Settings,
  MessageCircle,
  Users,
  X,
  Volume2
} from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { playNexoSound, startNexoOutgoingTone, startNexoRingtone } from '../lib/sounds';
import type {
  Channel,
  ChannelMessage,
  Conversation,
  Message,
  MessageReaction,
  MessageReply,
  MessageDelivery,
  MessagePin,
  Server,
  User
} from '../types';
import { apiFetch } from '../lib/api';
import { Avatar } from './Avatar';
import { Input, Textarea, Slider, Switch, Select } from './ui';
import { getSocket } from '../lib/socket';

type WorkspaceMode = 'servers' | 'friends';

type MessengerWorkspaceProps = {
  user: User;
  openConversationId?: number | null;
  openServerId?: number | null;
  openChannelId?: number | null;
  openMessageId?: number | null;
  embedded?: boolean;
  isActive?: boolean;
  showConversationList?: boolean;
  showChannelSidebar?: boolean;
  micMuted?: boolean;
  onToggleMic?: () => void;
  deafened?: boolean;
  audioInputId?: string;
  audioOutputId?: string;
  videoInputId?: string;
  pendingIncomingCall?: IncomingCall | null;
  onIncomingCallHandled?: () => void;
  onOpenSettings?: () => void;
  onEditChannel?: () => void;
  onFindFriends?: () => void;
  initialMode?: WorkspaceMode;
  showServersRail?: boolean;
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
  mediaType?: 'audio' | 'video';
  startedAt: number;
};

type Status = { type: 'idle' | 'loading' | 'success' | 'error'; message?: string };
type IncomingCall = { conversationId: number; from: number; user: User; mediaType: 'audio' | 'video'; groupTitle?: string };
type ServerMember = { id: number; user: User; role: string; nickname?: string; roles: Array<{ id: number; name: string; color: string; position: number }> };


function appendUniqueMessage(store: MessageStore, conversationId: number, message: Message): MessageStore {
  const current = store[conversationId] || [];
  if (current.some((item) => item.id === message.id)) return store;
  return { ...store, [conversationId]: [...current, message] };
}

function appendUniqueChannelMessage(store: ChannelMessageStore, channelId: number, message: ChannelMessage): ChannelMessageStore {
  const current = store[channelId] || [];
  if (current.some((item) => item.id === message.id)) return store;
  return { ...store, [channelId]: [...current, message] };
}

export function MessengerWorkspace({
  user,
  openConversationId = null,
  openServerId = null,
  openChannelId = null,
  openMessageId = null,
  embedded = false,
  isActive = true,
  showConversationList = true,
  showChannelSidebar = true,
  micMuted = false,
  onToggleMic,
  deafened = false,
  audioInputId = '',
  audioOutputId = '',
  videoInputId = '',
  pendingIncomingCall = null,
  onIncomingCallHandled,
  onOpenSettings,
  onEditChannel,
  onFindFriends,
  initialMode = 'servers',
  showServersRail = true
}: MessengerWorkspaceProps) {
  const [mode, setMode] = useState<WorkspaceMode>(initialMode);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messageStore, setMessageStore] = useState<MessageStore>({});
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [typingUser, setTypingUser] = useState<User | null>(null);
  const [animatedMessageIds, setAnimatedMessageIds] = useState<string[]>([]);
  const [callError, setCallError] = useState('');
  const [composerText, setComposerText] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingChannelMessageId, setEditingChannelMessageId] = useState<number | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ message: Message | ChannelMessage; kind: 'dm' | 'channel' } | null>(null);
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
  const incomingCallBackdropRef = useRef<HTMLDivElement>(null);
  const [callState, setCallState] = useState<CallState | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [ringtoneMuted, setRingtoneMuted] = useState(false);
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const [serverMembers, setServerMembers] = useState<ServerMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [messageContext, setMessageContext] = useState<{ x: number; y: number; message: Message | ChannelMessage; kind: 'dm' | 'channel' } | null>(null);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<Array<Message | ChannelMessage>>([]);
  const [membersError, setMembersError] = useState('');
  const pendingIncomingSignalRef = useRef<SignalData | null>(null);
  const awaitingCallAcceptRef = useRef<number | null>(null);
  const queuedCallSignalsRef = useRef<SignalData[]>([]);
  const callStateRef = useRef<CallState | null>(null);
  const previousChannelRef = useRef<number | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef(0);
  const lastReadSentRef = useRef<Record<number, number>>({});
  const lastChannelReadSentRef = useRef<Record<number, number>>({});
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const channelComposerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    setEditingChannelMessageId(null);
    setChannelComposer('');
    setReplyingTo(null);
    setPinnedPanelOpen(false);
    setPinnedMessages([]);
  }, [activeChannelId]);

  const callWasActiveRef = useRef(false);
  useEffect(() => {
    if (callState) {
      callWasActiveRef.current = true;
      window.dispatchEvent(new CustomEvent('nexo-call-state', { detail: {
        active: true, conversationId: callState.conversationId,
        title: conversations.find((conversation) => conversation.id === callState.conversationId)?.counterpart?.display_name || conversations.find((conversation) => conversation.id === callState.conversationId)?.counterpart?.username || 'Личный звонок',
        startedAt: callState.startedAt
      } }));
    } else if (callWasActiveRef.current) {
      callWasActiveRef.current = false;
      window.dispatchEvent(new CustomEvent('nexo-call-state', { detail: { active: false } }));
    }
  }, [callState, conversations]);

  useEffect(() => {
    if (!pendingIncomingCall || pendingIncomingCall.conversationId !== openConversationId) return;
    setIncomingCall(pendingIncomingCall);
    pendingIncomingSignalRef.current = null;
  }, [pendingIncomingCall, openConversationId]);

  useEffect(() => {
    fetchConversations();
    fetchServers();
  }, []);

  // Внешняя команда «открыть диалог»: подгружаем список (диалог мог быть только что создан)
  // и делаем его активным в разделе личных сообщений.
  useEffect(() => {
    if (!openConversationId) return;
    setMode('friends');
    setActiveConversationId(openConversationId);
    fetchConversations();
  }, [openConversationId]);

  useEffect(() => {
    if (!openServerId) return;
    setMode('servers');
    setActiveServerId(openServerId);
  }, [openServerId]);

  useEffect(() => {
    if (!openChannelId) return;
    setMode('servers');
    setActiveChannelId(openChannelId);
  }, [openChannelId]);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    socketRef.current = socket;
    const onConversationUpsert = ({ conversation }: { conversation: Conversation }) => {
      setConversations((prev) => prev.some((item) => item.id === conversation.id)
        ? prev.map((item) => item.id === conversation.id ? conversation : item)
        : [conversation, ...prev]);
    };
    const onMessageNew = ({ conversationId, message }: { conversationId: number; message: Message }) => {
      setMessageStore((prev) => appendUniqueMessage(prev, conversationId, message));
      if (message.author.id !== user.id) {
        const key = `dm:${message.id}`;
        setAnimatedMessageIds((current) => [...current.filter((item) => item !== key), key]);
        window.setTimeout(() => setAnimatedMessageIds((current) => current.filter((item) => item !== key)), 850);
      }
    };
    const onMessageAck = ({ conversationId, message }: { conversationId: number; message: Message }) =>
      setMessageStore((prev) => appendUniqueMessage(prev, conversationId, message));
    const onMessageDeliveryUpdate = ({ conversationId, messageId, delivery }: { conversationId: number; messageId: number; delivery: MessageDelivery }) =>
      setMessageStore((prev) => ({ ...prev, [conversationId]: (prev[conversationId] || []).map((item) => item.id === messageId ? { ...item, delivery } : item) }));
    const onMessageUpdate = ({ conversationId, message }: { conversationId: number; message: Message }) =>
      setMessageStore((prev) => ({ ...prev, [conversationId]: (prev[conversationId] || []).map((item) => item.id === message.id ? message : item) }));
    const onMessagePinUpdate = ({ conversationId, messageId, pin }: { conversationId: number; messageId: number; pin: MessagePin | null }) => {
      setMessageStore((prev) => ({ ...prev, [conversationId]: (prev[conversationId] || []).map((item) => item.id === messageId ? { ...item, pin } : item) }));
      setPinnedMessages((prev) => pin ? prev : prev.filter((item) => item.id !== messageId));
    };
    const onMessageReactionsUpdate = ({ conversationId, messageId, reactions }: { conversationId: number; messageId: number; reactions: MessageReaction[] }) =>
      setMessageStore((prev) => ({ ...prev, [conversationId]: (prev[conversationId] || []).map((item) => item.id === messageId ? { ...item, reactions } : item) }));
    const onMessageDelete = ({ conversationId, messageId }: { conversationId: number; messageId: number }) =>
      setMessageStore((prev) => ({ ...prev, [conversationId]: (prev[conversationId] || []).filter((message) => message.id !== messageId) }));
    const onTyping = ({ conversationId, user: typing, isTyping }: { conversationId: number; user: User; isTyping: boolean }) => {
      if (conversationId !== activeConversationId || typing?.id === user.id) return;
      setTypingUser(isTyping ? typing : null);
    };
    const onCallInvite = (payload: IncomingCall) => {
      if (payload.conversationId !== activeConversationId) return;
      setIncomingCall({ ...payload, mediaType: payload.mediaType === 'video' ? 'video' : 'audio' });
      setRingtoneMuted(false);
      pendingIncomingSignalRef.current = null;
    };
    const onCallSignal = ({ conversationId, payload }: { conversationId: number; payload: SignalData }) => {
      const current = callStateRef.current;
      if (current?.conversationId === conversationId) current.peer?.signal(payload);
    };
    const onCallAccept = ({ conversationId, mediaType }: { conversationId: number; mediaType?: 'audio' | 'video' }) => {
      if (mediaType === 'audio' && callStateRef.current?.conversationId === conversationId) {
        const current = callStateRef.current;
        const videoTrack = current.localStream?.getVideoTracks()[0];
        if (videoTrack) {
          current.peer?.removeTrack(videoTrack, current.localStream!);
          current.localStream?.removeTrack(videoTrack);
          videoTrack.stop();
          setCallState({ ...current });
        }
      }
      if (awaitingCallAcceptRef.current !== conversationId) return;
      awaitingCallAcceptRef.current = null;
      const queued = queuedCallSignalsRef.current.splice(0);
      queued.forEach((payload) => socket.emit('call:signal', { conversationId, payload }));
      playNexoSound('call-accepted');
    };
    const onCallReject = ({ conversationId }: { conversationId: number }) => {
      if (awaitingCallAcceptRef.current === conversationId) awaitingCallAcceptRef.current = null;
      if (callStateRef.current?.conversationId === conversationId) endCall(false);
    };
    const onCallError = ({ conversationId, message }: { conversationId: number; message: string }) => {
      if (callStateRef.current?.conversationId === conversationId) endCall(false);
      setCallError(message || 'Не удалось начать звонок.');
      playNexoSound('error');
    };
    const onCallTimeout = ({ conversationId }: { conversationId: number }) => {
      if (awaitingCallAcceptRef.current === conversationId) awaitingCallAcceptRef.current = null;
      if (callStateRef.current?.conversationId === conversationId) endCall(false);
      if (incomingCall?.conversationId === conversationId) {
        setIncomingCall(null);
        pendingIncomingSignalRef.current = null;
        onIncomingCallHandled?.();
      }
      playNexoSound('call-ended');
    };
    const onCallEnd = ({ conversationId }: { conversationId: number }) => {
      if (callStateRef.current?.conversationId === conversationId) endCall(false);
      if (incomingCall?.conversationId === conversationId) { setIncomingCall(null); onIncomingCallHandled?.(); }
    };
    const onServerUpsert = ({ server }: { server: Server }) => {
      setServers((prev) => prev.some((item) => item.id === server.id)
        ? prev.map((item) => item.id === server.id ? server : item)
        : [...prev, server]);
    };
    const onServerMessageUpdate = ({ channelId, message }: { channelId: number; message: ChannelMessage }) => {
      setChannelMessages((prev) => ({
        ...prev,
        [channelId]: (prev[channelId] || []).map((item) => item.id === message.id ? message : item)
      }));
    };
    const onChannelPinUpdate = ({ channelId, messageId, pin }: { channelId: number; messageId: number; pin: MessagePin | null }) => {
      setChannelMessages((prev) => ({ ...prev, [channelId]: (prev[channelId] || []).map((item) => item.id === messageId ? { ...item, pin } : item) }));
      setPinnedMessages((prev) => pin ? prev : prev.filter((item) => item.id !== messageId));
    };
    const onChannelReactionsUpdate = ({ channelId, messageId, reactions }: { channelId: number; messageId: number; reactions: MessageReaction[] }) =>
      setChannelMessages((prev) => ({ ...prev, [channelId]: (prev[channelId] || []).map((item) => item.id === messageId ? { ...item, reactions } : item) }));
    const onChannelReadUpdate = ({ channelId, userId, previousReadMessageId, lastReadMessageId }: {
      channelId: number; userId: number; previousReadMessageId: number; lastReadMessageId: number
    }) => {
      setChannelMessages((prev) => ({
        ...prev,
        [channelId]: (prev[channelId] || []).map((message) => {
          if (message.author.id === userId || message.id <= previousReadMessageId || message.id > lastReadMessageId) return message;
          const receipt = message.read_receipt || { read_count: 0, member_count: 0 };
          return { ...message, read_receipt: {
            ...receipt,
            read_count: Math.min(receipt.member_count, receipt.read_count + 1)
          } };
        })
      }));
    };
    const onChannelMessage = ({ channelId, message }: { channelId: number; message: ChannelMessage }) => {
      setChannelMessages((prev) => appendUniqueChannelMessage(prev, channelId, message));
      if (message.author.id !== user.id) {
        const key = `channel:${message.id}`;
        setAnimatedMessageIds((current) => [...current.filter((item) => item !== key), key]);
        window.setTimeout(() => setAnimatedMessageIds((current) => current.filter((item) => item !== key)), 850);
      }
    };
    const onChannelMessageDelete = ({ channelId, messageId }: { channelId: number; messageId: number }) =>
      setChannelMessages((prev) => ({ ...prev, [channelId]: (prev[channelId] || []).filter((message) => message.id !== messageId) }));
    const onChannelDeleted = ({ serverId, channelId }: { serverId: number; channelId: number }) => {
      setServers((prev) => prev.map((server) => server.id === serverId ? { ...server, channels: server.channels.filter((channel) => channel.id !== channelId) } : server));
      if (activeChannelId === channelId) setActiveChannelId(null);
    };
    const onSocketError = (payload: { message?: string }) => console.warn('Socket error', payload);

    socket.on('conversation:upsert', onConversationUpsert);
    socket.on('message:new', onMessageNew);
    socket.on('message:ack', onMessageAck);
    socket.on('message:delivery:update', onMessageDeliveryUpdate);
    socket.on('message:update', onMessageUpdate);
    socket.on('message:reactions:update', onMessageReactionsUpdate);
    socket.on('message:pin:update', onMessagePinUpdate);
    socket.on('message:delete', onMessageDelete);
    socket.on('typing', onTyping);
    socket.on('call:ring', onCallInvite);
    socket.on('call:signal', onCallSignal);
    socket.on('call:accept', onCallAccept);
    socket.on('call:decline', onCallReject);
    socket.on('call:timeout', onCallTimeout);
    socket.on('call:error', onCallError);
    socket.on('call:end', onCallEnd);
    socket.on('server:upsert', onServerUpsert);
    socket.on('channel:message:new', onChannelMessage);
    socket.on('channel:reactions:update', onChannelReactionsUpdate);
    socket.on('channel:pin:update', onChannelPinUpdate);
    socket.on('channel:read:update', onChannelReadUpdate);
    socket.on('server:message:update', onServerMessageUpdate);
    socket.on('channel:message:delete', onChannelMessageDelete);
    socket.on('channel:deleted', onChannelDeleted);
    socket.on('error', onSocketError);
    return () => {
      socket.off('conversation:upsert', onConversationUpsert);
      socket.off('message:new', onMessageNew);
      socket.off('message:ack', onMessageAck);
      socket.off('message:delivery:update', onMessageDeliveryUpdate);
      socket.off('message:update', onMessageUpdate);
      socket.off('message:reactions:update', onMessageReactionsUpdate);
      socket.off('message:pin:update', onMessagePinUpdate);
      socket.off('message:delete', onMessageDelete);
      socket.off('typing', onTyping);
      socket.off('call:ring', onCallInvite);
      socket.off('call:signal', onCallSignal);
      socket.off('call:accept', onCallAccept);
      socket.off('call:decline', onCallReject);
      socket.off('call:timeout', onCallTimeout);
      socket.off('call:error', onCallError);
      socket.off('call:end', onCallEnd);
      socket.off('server:upsert', onServerUpsert);
      socket.off('channel:message:new', onChannelMessage);
      socket.off('channel:reactions:update', onChannelReactionsUpdate);
      socket.off('channel:pin:update', onChannelPinUpdate);
      socket.off('channel:read:update', onChannelReadUpdate);
      socket.off('server:message:update', onServerMessageUpdate);
      socket.off('channel:message:delete', onChannelMessageDelete);
      socket.off('channel:deleted', onChannelDeleted);
      socket.off('error', onSocketError);
      socketRef.current = null;
    };
  }, [user, activeConversationId, incomingCall, onIncomingCallHandled]);

  useEffect(() => {
    if (!isActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setMessageSearchOpen(true);
      }
      if (event.key === 'Escape' && messageSearchOpen) setMessageSearchOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isActive, messageSearchOpen]);

  useEffect(() => {
    if (!incomingCall) return;
    const conversationId = incomingCall.conversationId;
    const timeout = window.setTimeout(() => {
      socketRef.current?.emit('call:timeout', { conversationId });
      pendingIncomingSignalRef.current = null;
      setIncomingCall((current) => current?.conversationId === conversationId ? null : current);
      playNexoSound('call-ended');
      onIncomingCallHandled?.();
    }, 45000);
    return () => window.clearTimeout(timeout);
  }, [incomingCall?.conversationId]);

  useEffect(() => {
    if (!callState?.initiator || callState.remoteStream) return;
    const conversationId = callState.conversationId;
    const timeout = window.setTimeout(() => {
      const current = callStateRef.current;
      if (!current || current.conversationId !== conversationId || current.remoteStream) return;
      socketRef.current?.emit('call:timeout', { conversationId });
      setCallError('Нет ответа');
      endCall(false);
    }, 45000);
    return () => window.clearTimeout(timeout);
  }, [callState?.conversationId, callState?.initiator, Boolean(callState?.remoteStream)]);

  useEffect(() => {
    if (!incomingCall || ringtoneMuted) return;
    return startNexoRingtone();
  }, [incomingCall, ringtoneMuted]);

  useEffect(() => {
    if (!callState?.initiator || callState.remoteStream) return;
    return startNexoOutgoingTone();
  }, [callState?.conversationId, callState?.initiator, Boolean(callState?.remoteStream)]);

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

  useEffect(() => {
    if (!showMembersPanel || !activeServerId) return;
    let cancelled = false;
    setMembersLoading(true);
    setMembersError('');
    apiFetch(`/api/servers/${activeServerId}/members`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'Не удалось загрузить участников.');
        if (!cancelled) setServerMembers(payload.members || []);
      })
      .catch((error) => { if (!cancelled) setMembersError((error as Error).message); })
      .finally(() => { if (!cancelled) setMembersLoading(false); });
    return () => { cancelled = true; };
  }, [showMembersPanel, activeServerId]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) || null,
    [conversations, activeConversationId]
  );

  const activeMessages = activeConversationId ? messageStore[activeConversationId] || [] : [];

  useEffect(() => {
    setReplyingTo(null);
    setPinnedPanelOpen(false);
    setPinnedMessages([]);
  }, [activeConversationId]);

  useEffect(() => {
    if (editingMessageId === null) return;
    setEditingMessageId(null);
    setComposerText('');
    setUploadFile(null);
  }, [activeConversationId]);


  useEffect(() => {
    const latestMessage = activeMessages[activeMessages.length - 1];
    if (!activeConversationId || !isActive || !latestMessage) return;
    const previousReadId = lastReadSentRef.current[activeConversationId] || 0;
    if (latestMessage.id <= previousReadId) return;

    lastReadSentRef.current[activeConversationId] = latestMessage.id;
    void apiFetch(`/api/conversations/${activeConversationId}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: latestMessage.id })
    }).then((response) => {
      if (!response.ok && lastReadSentRef.current[activeConversationId] === latestMessage.id) {
        lastReadSentRef.current[activeConversationId] = previousReadId;
      }
    }).catch(() => {
      if (lastReadSentRef.current[activeConversationId] === latestMessage.id) {
        lastReadSentRef.current[activeConversationId] = previousReadId;
      }
    });
  }, [activeConversationId, activeMessages, isActive]);


  useEffect(() => {
    const element = composerRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = Math.min(element.scrollHeight, 192) + 'px';
  }, [composerText]);

  useEffect(() => {
    const element = channelComposerRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = Math.min(element.scrollHeight, 192) + 'px';
  }, [channelComposer]);

  function insertCodeBlock(channel = false) {
    const ref = channel ? channelComposerRef : composerRef;
    const setter = channel ? setChannelComposer : setComposerText;
    const current = channel ? channelComposer : composerText;
    const element = ref.current;
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    const selected = current.slice(start, end);
    const wrapper = ['```', selected, '```'].join('\n');
    const next = current.slice(0, start) + wrapper + current.slice(end);
    setter(next);
    window.requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      const caret = start + wrapper.length;
      element.setSelectionRange(caret, caret);
    });
  }
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
    const latestMessage = activeChannelMessages[activeChannelMessages.length - 1];
    if (mode !== 'servers' || !activeServerId || !activeChannelId || !isActive || !latestMessage) return;
    const previousReadId = lastChannelReadSentRef.current[activeChannelId] || 0;
    if (latestMessage.id <= previousReadId) return;
    lastChannelReadSentRef.current[activeChannelId] = latestMessage.id;
    void apiFetch(`/api/servers/${activeServerId}/channels/${activeChannelId}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: latestMessage.id })
    }).then((response) => {
      if (!response.ok && lastChannelReadSentRef.current[activeChannelId] === latestMessage.id) {
        lastChannelReadSentRef.current[activeChannelId] = previousReadId;
      }
    }).catch(() => {
      if (lastChannelReadSentRef.current[activeChannelId] === latestMessage.id) {
        lastChannelReadSentRef.current[activeChannelId] = previousReadId;
      }
    });
  }, [mode, activeServerId, activeChannelId, activeChannelMessages, isActive]);
  const messageSearchItems = useMemo(() => activeChannel ? activeChannelMessages : activeMessages, [activeChannel, activeChannelMessages, activeMessages]);
  const messageSearchResults = useMemo(() => {
    const query = messageSearchQuery.trim().toLocaleLowerCase('ru-RU');
    if (!query) return [];
    return messageSearchItems.filter((message) => `${message.author.display_name || message.author.username} ${message.content || ''}`.toLocaleLowerCase('ru-RU').includes(query)).slice(0, 20);
  }, [messageSearchItems, messageSearchQuery]);

  useEffect(() => {
    if (!openMessageId) return;
    const exists = activeMessages.some((message) => message.id === openMessageId)
      || activeChannelMessages.some((message) => message.id === openMessageId);
    if (!exists) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(mode === 'friends' ? `nexo-message-${openMessageId}` : `nexo-channel-message-${openMessageId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openMessageId, activeMessages.length, activeChannelMessages.length, mode, activeConversationId, activeServerId, activeChannelId]);


  useEffect(() => {
    if (!activeServer) return;
    const channels = activeServer.channels || [];
    const currentExists = channels.some((channel) => channel.id === activeChannelId);
    if (currentExists) return;
    const firstText = channels.find((channel) => channel.type === 'text');
    setActiveChannelId(firstText?.id ?? null);
  }, [activeServer, activeChannelId, openChannelId]);

  async function fetchConversations() {
    try {
      const response = await apiFetch('/api/conversations');
      if (!response.ok) throw new Error('Failed to load conversations');
      const data = await response.json();
      setConversations(data.conversations || []);
      if (openConversationId && data.conversations?.some((item: Conversation) => item.id === openConversationId)) {
        setActiveConversationId(openConversationId);
      } else if (!activeConversationId && data.conversations?.length) {
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
      if (openServerId && next.some((server) => server.id === openServerId)) {
        setActiveServerId(openServerId);
      } else if (!activeServerId && next.length > 0) {
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
      const incomingIds = (data.messages || []).filter((message: Message) => message.author.id !== user.id).map((message: Message) => message.id);
      if (incomingIds.length) {
        void apiFetch(`/api/conversations/${conversationId}/delivered`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageIds: incomingIds })
        }).catch(() => {});
      }
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

  async function toggleMessagePin(message: Message | ChannelMessage, kind: 'dm' | 'channel') {
    const action = message.pin ? 'unpin' : 'pin';
    try {
      const path = kind === 'dm' && 'conversation_id' in message
        ? `/api/conversations/${message.conversation_id}/messages/${message.id}/pin`
        : `/api/servers/${(message as ChannelMessage).server_id}/channels/${(message as ChannelMessage).channel_id}/messages/${message.id}/pin`;
      const response = await apiFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось изменить закрепление.');
      if (kind === 'dm' && 'conversation_id' in message) {
        setMessageStore((prev) => ({ ...prev, [message.conversation_id]: (prev[message.conversation_id] || []).map((item) => item.id === message.id ? { ...item, pin: payload.pin } : item) }));
      } else {
        const channelId = (message as ChannelMessage).channel_id;
        setChannelMessages((prev) => ({ ...prev, [channelId]: (prev[channelId] || []).map((item) => item.id === message.id ? { ...item, pin: payload.pin } : item) }));
      }
      setPinnedMessages((prev) => action === 'pin'
        ? [...prev.filter((item) => item.id !== message.id), { ...message, pin: payload.pin }]
        : prev.filter((item) => item.id !== message.id));
      setMessageContext(null);
    } catch (error) {
      window.alert((error as Error).message);
    }
  }

  async function togglePinnedPanel(kind: 'dm' | 'channel') {
    if (pinnedPanelOpen) { setPinnedPanelOpen(false); return; }
    try {
      const path = kind === 'dm' && activeConversationId
        ? `/api/conversations/${activeConversationId}/pins`
        : activeServerId && activeChannelId
          ? `/api/servers/${activeServerId}/channels/${activeChannelId}/pins`
          : '';
      if (!path) return;
      const response = await apiFetch(path);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось загрузить закреплённые сообщения.');
      setPinnedMessages(payload.pins || []);
      setPinnedPanelOpen(true);
    } catch (error) {
      window.alert((error as Error).message);
    }
  }

  async function toggleMessageReaction(message: Message | ChannelMessage, kind: 'dm' | 'channel', emoji: string) {
    try {
      const path = kind === 'dm' && 'conversation_id' in message
        ? `/api/conversations/${message.conversation_id}/messages/${message.id}/reactions`
        : `/api/servers/${(message as ChannelMessage).server_id}/channels/${(message as ChannelMessage).channel_id}/messages/${message.id}/reactions`;
      const response = await apiFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось добавить реакцию.');
      if (kind === 'dm' && 'conversation_id' in message) {
        setMessageStore((prev) => ({
          ...prev,
          [message.conversation_id]: (prev[message.conversation_id] || []).map((item) => item.id === message.id ? { ...item, reactions: payload.reactions || [] } : item)
        }));
      } else {
        const channelId = (message as ChannelMessage).channel_id;
        setChannelMessages((prev) => ({
          ...prev,
          [channelId]: (prev[channelId] || []).map((item) => item.id === message.id ? { ...item, reactions: payload.reactions || [] } : item)
        }));
      }
      setMessageContext(null);
    } catch (error) {
      window.alert((error as Error).message);
    }
  }

  async function deleteMessage(message: Message | ChannelMessage, kind: 'dm' | 'channel') {
    if (message.author.id !== user.id) return;
    const confirmText = 'Удалить это сообщение?';
    if (!window.confirm(confirmText)) return;
    try {
      const path = kind === 'dm' && 'conversation_id' in message
        ? `/api/conversations/${message.conversation_id}/messages/${message.id}`
        : `/api/servers/${(message as ChannelMessage).server_id}/channels/${(message as ChannelMessage).channel_id}/messages/${message.id}`;
      const response = await apiFetch(path, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось удалить сообщение.');
      setMessageContext(null);
      if (kind === 'dm' && 'conversation_id' in message) {
        setMessageStore((prev) => ({ ...prev, [message.conversation_id]: (prev[message.conversation_id] || []).filter((item) => item.id !== message.id) }));
      } else {
        const channelId = (message as ChannelMessage).channel_id;
        setChannelMessages((prev) => ({ ...prev, [channelId]: (prev[channelId] || []).filter((item) => item.id !== message.id) }));
      }
    } catch (error) { window.alert((error as Error).message); }
  }

  function jumpToSearchResult(messageId: number) {
    const prefix = activeChannel ? 'nexo-channel-message-' : 'nexo-message-';
    setMessageSearchOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById(prefix + messageId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function beginReplyMessage(message: Message | ChannelMessage, kind: 'dm' | 'channel') {
    setReplyingTo({ message, kind });
    setMessageContext(null);
    if (kind === 'dm') {
      setEditingMessageId(null);
      window.requestAnimationFrame(() => composerRef.current?.focus());
    } else {
      setEditingChannelMessageId(null);
      window.requestAnimationFrame(() => channelComposerRef.current?.focus());
    }
  }

  function beginEditMessage(message: Message | ChannelMessage) {
    if (message.author.id !== user.id || !message.content) return;
    setMessageContext(null);
    setReplyingTo(null);
    if ('channel_id' in message) {
      setEditingMessageId(null);
      setEditingChannelMessageId(message.id);
      setChannelUpload(null);
      setChannelComposer(message.content);
      window.requestAnimationFrame(() => channelComposerRef.current?.focus());
      return;
    }
    setEditingChannelMessageId(null);
    setUploadFile(null);
    setEditingMessageId(message.id);
    setComposerText(message.content);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function openMessageMenu(event: ReactMouseEvent, message: Message | ChannelMessage, kind: 'dm' | 'channel') {
    event.preventDefault();
    setMessageContext({ x: event.clientX, y: event.clientY, message, kind });
  }

  function sendTyping(isTyping: boolean) {
    if (!activeConversationId || !socketRef.current) return;
    if (isTyping) {
      const now = Date.now();
      if (now - lastTypingSentRef.current >= 1000) {
        socketRef.current.emit('typing', { conversationId: activeConversationId, isTyping: true });
        lastTypingSentRef.current = now;
      }
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = window.setTimeout(() => {
        socketRef.current?.emit('typing', { conversationId: activeConversationId, isTyping: false });
        typingTimerRef.current = null;
      }, 2200);
    } else {
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
      socketRef.current.emit('typing', { conversationId: activeConversationId, isTyping: false });
    }
  }

  async function handleSendMessage() {
    sendTyping(false);
    if (!activeConversationId) return;
    if (!composerText.trim() && !uploadFile) return;

    if (editingMessageId !== null) {
      try {
        const response = await apiFetch(`/api/conversations/${activeConversationId}/messages/${editingMessageId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: composerText })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'Не удалось изменить сообщение.');
        setMessageStore((prev) => ({
          ...prev,
          [activeConversationId]: (prev[activeConversationId] || []).map((item) => item.id === editingMessageId ? payload.message : item)
        }));
        setComposerText('');
        setEditingMessageId(null);
      } catch (error) {
        window.alert((error as Error).message);
      }
      return;
    }

    const formData = new FormData();
    formData.append('content', composerText);
    if (replyingTo?.kind === 'dm') formData.append('replyToMessageId', String(replyingTo.message.id));
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
      setMessageStore((prev) => appendUniqueMessage(prev, activeConversationId, data.message));
      const sentKey = `dm:${data.message.id}`;
      setAnimatedMessageIds((current) => [...current.filter((item) => item !== sentKey), sentKey]);
      window.setTimeout(() => setAnimatedMessageIds((current) => current.filter((item) => item !== sentKey)), 850);
      playNexoSound('send');
      setComposerText('');
      setUploadFile(null);
      setReplyingTo(null);
    } catch (error) {
      playNexoSound('error');
      console.error(error);
    }
  }

  async function handleSendChannelMessage() {
    if (!activeServerId || !activeChannelId) return;
    if (!channelComposer.trim() && !channelUpload) return;

    if (editingChannelMessageId !== null) {
      try {
        const response = await apiFetch(`/api/servers/${activeServerId}/channels/${activeChannelId}/messages/${editingChannelMessageId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: channelComposer })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'Не удалось изменить сообщение.');
        setChannelMessages((prev) => ({
          ...prev,
          [activeChannelId]: (prev[activeChannelId] || []).map((item) => item.id === editingChannelMessageId ? payload.message : item)
        }));
        setChannelComposer('');
        setEditingChannelMessageId(null);
      } catch (error) {
        window.alert((error as Error).message);
      }
      return;
    }

    const formData = new FormData();
    formData.append('content', channelComposer);
    if (replyingTo?.kind === 'channel') formData.append('replyToMessageId', String(replyingTo.message.id));
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
      setChannelMessages((prev) => appendUniqueChannelMessage(prev, activeChannelId, data.message));
      const sentKey = `channel:${data.message.id}`;
      setAnimatedMessageIds((current) => [...current.filter((item) => item !== sentKey), sentKey]);
      window.setTimeout(() => setAnimatedMessageIds((current) => current.filter((item) => item !== sentKey)), 850);
      playNexoSound('send');
      setChannelComposer('');
      setChannelUpload(null);
      setReplyingTo(null);
    } catch (error) {
      playNexoSound('error');
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

  async function startCall(conversationId: number, options?: { initiator?: boolean; initialSignal?: SignalData }, mediaType: 'audio' | 'video' = 'audio'): Promise<boolean> {
    if (!socketRef.current) return false;
    if (document.documentElement.dataset.nexoVoiceActive === 'true') {
      if (!window.confirm('Выйти из голосового канала и начать личный звонок?')) return false;
      const channelId = Number(document.documentElement.dataset.nexoVoiceChannelId);
      if (Number.isInteger(channelId)) window.dispatchEvent(new CustomEvent('nexo-voice-action', { detail: { channelId, action: 'leave' } }));
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
    setCallError('');
    try {
      const audioConstraint: MediaTrackConstraints | boolean = audioInputId ? { deviceId: { exact: audioInputId } } : true;
      const videoConstraint: MediaTrackConstraints | boolean = mediaType === 'video' ? (videoInputId ? { deviceId: { exact: videoInputId } } : true) : false;
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: videoConstraint });
      mediaStream.getAudioTracks().forEach((track) => { track.enabled = !micMuted; });
      const peer = new SimplePeer({
        initiator: options?.initiator ?? true,
        trickle: false,
        stream: mediaStream
      });

      if (options?.initiator !== false) {
        awaitingCallAcceptRef.current = conversationId;
        queuedCallSignalsRef.current = [];
      }
      const state: CallState = {
        conversationId,
        peer,
        localStream: mediaStream,
        remoteStream: null,
        isScreenSharing: false,
        initiator: options?.initiator ?? true,
        mediaType,
        startedAt: Date.now()
      };
      callStateRef.current = state;
      setCallState(state);
      if (options?.initiator !== false) socketRef.current.emit('call:ring', { conversationId, mediaType });

      peer.on('signal', (payload) => {
        if (awaitingCallAcceptRef.current === conversationId) {
          queuedCallSignalsRef.current.push(payload);
          return;
        }
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

      if (options?.initialSignal) peer.signal(options.initialSignal);
      return true;
    } catch (error) {
      const mediaError = error as DOMException;
      const message = mediaError?.name === 'NotAllowedError'
        ? 'Разрешите Nexo доступ к микрофону и камере в настройках Windows.'
        : mediaError?.name === 'NotFoundError'
          ? 'Не найдено подходящее аудиоустройство. Проверьте подключение микрофона.'
          : mediaError?.name === 'NotReadableError'
            ? 'Устройство уже используется другим приложением.'
            : (mediaError?.message || 'Не удалось начать звонок.');
      setCallError(message);
      console.error('Failed to start call', error);
      return false;
    }
  }

  async function handleIncomingSignal(conversationId: number, payload: SignalData) {
    const current = callStateRef.current;
    if (!current || current.conversationId !== conversationId) {
      pendingIncomingSignalRef.current = payload;
      return;
    }
    current.peer?.signal(payload);
  }

  async function acceptIncomingCall(acceptedMediaType?: 'audio' | 'video') {
    if (!incomingCall) return;
    const call = incomingCall;
    pendingIncomingSignalRef.current = null;
    setIncomingCall(null);
    const started = await startCall(call.conversationId, { initiator: false }, acceptedMediaType || call.mediaType);
    if (!started) {
      socketRef.current?.emit('call:decline', { conversationId: call.conversationId });
      onIncomingCallHandled?.();
      return;
    }
    socketRef.current?.emit('call:accept', { conversationId: call.conversationId, mediaType: acceptedMediaType || call.mediaType });
    playNexoSound('call-accepted');
    onIncomingCallHandled?.();
  }

  function rejectIncomingCall() {
    if (!incomingCall) return;
    socketRef.current?.emit('call:decline', { conversationId: incomingCall.conversationId });
    pendingIncomingSignalRef.current = null;
    setIncomingCall(null);
    playNexoSound('call-ended');
    onIncomingCallHandled?.();
  }

  useEffect(() => {
    callState?.localStream?.getAudioTracks().forEach((track) => { track.enabled = !micMuted; });
  }, [callState, micMuted]);

  useEffect(() => {
    const onGlobalEndCall = () => { if (callStateRef.current) endCall(true); };
    window.addEventListener('nexo-end-call', onGlobalEndCall);
    return () => window.removeEventListener('nexo-end-call', onGlobalEndCall);
  }, []);

  function endCall(notifyRemote = true) {
    const current = callStateRef.current;
    if (!current) return;
    if (awaitingCallAcceptRef.current === current.conversationId) awaitingCallAcceptRef.current = null;
    queuedCallSignalsRef.current = [];
    callStateRef.current = null;
    setCallState(null);
    if (notifyRemote) socketRef.current?.emit('call:end', { conversationId: current.conversationId });
    playNexoSound('call-ended');
    current.peer?.destroy();
    current.localStream?.getTracks().forEach((track) => track.stop());
    current.remoteStream?.getTracks().forEach((track) => track.stop());
  }

  function toggleCamera() {
    const track = callStateRef.current?.localStream?.getVideoTracks()[0];
    if (!track || callStateRef.current?.isScreenSharing) return;
    track.enabled = !track.enabled;
    setCallState((current) => current ? { ...current } : current);
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
      <div className={'workspace-grid ' + (showConversationList ? '' : 'embedded-dm')}>
        <aside className="conversation-list">
          <header>
            <h3><MessageCircle size={16} />Диалоги</h3>
            {onFindFriends && <button type="button" className="ghost subtle" onClick={onFindFriends}>Найти людей</button>}
          </header>
          <div className="conversation-items">
            {conversations.length === 0 && <p className="muted">Нет диалогов — добавьте друзей.</p>}
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={`conversation-item ${conversation.id === activeConversationId ? 'active' : ''}`}
                onClick={() => setActiveConversationId(conversation.id)}
              >
                <Avatar user={conversation.counterpart} size={36} showStatus />
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
                  <MessageCircle size={15} />
                  {activeConversation.title}
                </div>
                <div className="chat-actions">
                  <button type="button" className="ghost" onClick={() => { setMessageSearchOpen(true); setMessageSearchQuery(''); }} title="Поиск по сообщениям (Ctrl+F)" aria-label="Поиск по сообщениям"><Search size={16} />Поиск</button>
                  <button type="button" className={pinnedPanelOpen ? 'ghost active' : 'ghost'} onClick={() => void togglePinnedPanel('dm')} title="Закреплённые сообщения"><Pin size={16} />Закреплённые</button>
                  <button type="button" className="ghost" onClick={() => startCall(activeConversation.id, { initiator: true }, 'audio')}>
                    <Phone size={16} />Голос
                  </button>
                  <button type="button" className="ghost" onClick={() => startCall(activeConversation.id, { initiator: true }, 'video')}>
                    <Monitor size={16} />Видео
                  </button>
                </div>
              </header>
              {pinnedPanelOpen && <div className="pinned-messages-panel">
                <strong>Закреплённые сообщения</strong>
                {pinnedMessages.length ? pinnedMessages.map((pin) => <button key={pin.id} type="button" onClick={() => { setPinnedPanelOpen(false); document.getElementById(`nexo-message-${pin.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
                  <span>{pin.author.display_name || pin.author.username}</span><small>{pin.content || 'Вложение'}</small>
                </button>) : <p>Пока ничего не закреплено.</p>}
              </div>}
              {callState?.conversationId === activeConversation.id && <CallOverlay
                state={callState}
                peer={activeConversation.counterpart || activeConversation.participants.find((participant) => participant.id !== user.id) || null}
                currentUser={user}
                micMuted={micMuted}
                onToggleMic={onToggleMic}
                onHangUp={endCall}
                onShareScreen={shareScreen}
                onToggleCamera={toggleCamera}
                audioOutputId={audioOutputId}
                deafened={deafened}
              />}
              {messageSearchOpen && <div className="message-search-panel">
                <div className="message-search-input-wrap">
                  <Search size={15} />
                  <Input autoFocus value={messageSearchQuery} onChange={(event) => setMessageSearchQuery(event.target.value)}
                    placeholder="Поиск по сообщениям и авторам…" aria-label="Поиск по сообщениям" />
                  <button type="button" className="ghost-icon" onClick={() => setMessageSearchOpen(false)} aria-label="Закрыть поиск"><X size={15} /></button>
                </div>
                {messageSearchQuery.trim() && <div className="message-search-results">
                  {messageSearchResults.length ? messageSearchResults.map((message) => (
                    <button key={message.id} type="button" onClick={() => jumpToSearchResult(message.id)}>
                      <strong>{message.author.display_name || message.author.username}</strong>
                      <span>{message.content || 'Вложение'}</span>
                      <time>{new Date(message.created_at).toLocaleDateString('ru-RU')}</time>
                    </button>
                  )) : <p>Ничего не найдено в загруженной истории.</p>}
                </div>}
              </div>}
              <div className="message-stream">
                {loadingMessages && <p className="muted">Загружаем…</p>}
                {!loadingMessages &&
                  activeMessages.map((message, index) => {
                    const previous = activeMessages[index - 1];
                    const grouped = Boolean(previous && previous.author.id === message.author.id &&
                      new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() < 5 * 60 * 1000);
                    const authorName = message.author.display_name || message.author.username;
                    const dayChanged = !previous || getMessageDayKey(previous.created_at) !== getMessageDayKey(message.created_at);
                    return (
                      <Fragment key={message.id}>
                        {dayChanged && <div className="message-day-divider"><span>{getMessageDayLabel(message.created_at)}</span></div>}
                        <article id={`nexo-message-${message.id}`} className={`message-row ${grouped ? 'grouped' : ''} ${animatedMessageIds.includes(`dm:${message.id}`) ? 'message-arrived' : ''}`}
                          onContextMenu={(event) => openMessageMenu(event, message, 'dm')}>
                          {grouped ? <span className="message-avatar-spacer" /> : <Avatar user={message.author} size={34} />}
                          <div className="message-body">
                            {!grouped && <header><strong>{authorName}</strong><time className="message-time" data-tooltip={new Date(message.created_at).toLocaleString('ru-RU')}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header>}
                            {message.reply_to && <MessageReplyPreview replyTo={message.reply_to} onClick={() => document.getElementById(`nexo-message-${message.reply_to!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />}
                            {message.content && <MessageContent content={message.content} />}
                            {message.edited_at && <small className="message-edited-label">изменено</small>}
                            {message.pin && <small className="message-pinned-label"><Pin size={11} />Закреплено</small>}
                            {message.attachment && <AttachmentPreview attachment={message.attachment} />}
                            <MessageReactions reactions={message.reactions || []} userId={user.id} onToggle={(emoji) => void toggleMessageReaction(message, 'dm', emoji)} />
                            {activeConversation?.type === 'dm' && message.author.id === user.id && index === activeMessages.map((item) => item.author.id === user.id).lastIndexOf(true) &&
                              (activeConversation.participants.find((participant) => participant.id !== user.id)?.last_read_message_id || 0) >= message.id &&
                              <small className="message-read-receipt">Прочитано</small>}
                            {activeConversation?.type === 'dm' && message.author.id === user.id && index === activeMessages.map((item) => item.author.id === user.id).lastIndexOf(true) && ((activeConversation.participants.find((participant) => participant.id !== user.id)?.last_read_message_id || 0) < message.id) && <small className="message-delivery-state">{(message.delivery?.delivered_count || 0) > 0 ? `Доставлено ${message.delivery?.delivered_count}/${message.delivery?.recipient_count}` : 'Отправлено'}</small>}
                          </div>
                        </article>
                      </Fragment>
                    );
                  })}
              </div>
              {typingUser && <div className="typing-indicator">{typingUser.display_name || typingUser.username} печатает…</div>}
              {callError && <p className="status error call-error">{callError}</p>}
              {replyingTo?.kind === 'dm' && (
                <div className="composer-editing-banner composer-replying-banner">
                  <span>Ответ для {replyingTo.message.author.display_name || replyingTo.message.author.username}: {replyingTo.message.content || 'Вложение'}</span>
                  <button type="button" className="link" onClick={() => setReplyingTo(null)}>Отмена</button>
                </div>
              )}
              <div className={`composer ${editingMessageId !== null ? 'editing' : ''}`}>
                {editingMessageId !== null && (
                  <div className="composer-editing-banner">
                    <span>Редактирование сообщения</span>
                    <button type="button" className="link" onClick={() => { setEditingMessageId(null); setComposerText(''); }}>Отмена</button>
                  </div>
                )}
                <label className="file-pill">
                  <Paperclip size={16} />
                  <Input
                    type="file"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) setUploadFile(file);
                    }}
                  />
                </label>
                <button type="button" className="composer-code-button" data-tooltip="Вставить блок кода" aria-label="Вставить блок кода" onClick={() => insertCodeBlock(false)}><Code size={16} /></button>
                <Textarea
                  ref={composerRef}
                  placeholder="Напишите сообщение..."
                  value={composerText}
                  onChange={(event) => { setComposerText(event.target.value); sendTyping(Boolean(event.target.value.trim())); }}
                  onBlur={() => sendTyping(false)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSendMessage(); } }}
                  onPaste={(event) => { const file = Array.from(event.clipboardData.files)[0]; if (file) { event.preventDefault(); setUploadFile(file); } }}
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
          <h2>Добро пожаловать в Nexo</h2>
          <p>Создайте первое пространство для команды, проекта или сообщества.</p>
          <button className="primary" onClick={() => setShowCreateServer(true)}>
            <Plus size={16} />
            Создать сервер
          </button>
        </div>
      );
    }

    return (
      <div className={'workspace-grid servers ' + (showChannelSidebar ? '' : 'embedded-channel')}>
        <section className="channel-column">
          {activeServer ? (
            <ServerSidebar
              server={activeServer}
              activeChannelId={activeChannelId}
              onSelectChannel={setActiveChannelId}
              onOpenSettings={onOpenSettings}
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
                  <button type="button" className="ghost" onClick={() => { setMessageSearchOpen(true); setMessageSearchQuery(''); }} title="Поиск по сообщениям (Ctrl+F)" aria-label="Поиск по сообщениям"><Search size={16} />Поиск</button>
                  <button type="button" className={pinnedPanelOpen ? 'ghost active' : 'ghost'} onClick={() => void togglePinnedPanel('channel')} title="Закреплённые сообщения"><Pin size={16} />Закреплённые</button>
                  <button type="button" className={showMembersPanel ? 'ghost active' : 'ghost'} onClick={() => setShowMembersPanel((value) => !value)} title="Показать участников" aria-label="Показать участников">
                    <Users size={16} />Участники
                  </button>
                  {onEditChannel && <button type="button" className="ghost" onClick={onEditChannel} data-tooltip="Настройки канала" aria-label="Настройки канала"><Settings size={16} />Канал</button>}
                </div>
              </header>
              {pinnedPanelOpen && <div className="pinned-messages-panel">
                <strong>Закреплённые сообщения</strong>
                {pinnedMessages.length ? pinnedMessages.map((pin) => <button key={pin.id} type="button" onClick={() => { setPinnedPanelOpen(false); document.getElementById(`nexo-channel-message-${pin.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
                  <span>{pin.author.display_name || pin.author.username}</span><small>{pin.content || 'Вложение'}</small>
                </button>) : <p>Пока ничего не закреплено.</p>}
              </div>}
              <div className="message-stream">
                {loadingChannelMessages && <p className="muted">Загружаем…</p>}
                {!loadingChannelMessages &&
                  activeChannelMessages.map((message, index) => {
                    const previous = activeChannelMessages[index - 1];
                    const grouped = Boolean(previous && previous.author.id === message.author.id &&
                      new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() < 5 * 60 * 1000);
                    const authorName = message.author.display_name || message.author.username;
                    const dayChanged = !previous || getMessageDayKey(previous.created_at) !== getMessageDayKey(message.created_at);
                    return (
                      <Fragment key={message.id}>
                        {dayChanged && <div className="message-day-divider"><span>{getMessageDayLabel(message.created_at)}</span></div>}
                        <article id={`nexo-channel-message-${message.id}`} className={`message-row ${grouped ? 'grouped' : ''} ${animatedMessageIds.includes(`channel:${message.id}`) ? 'message-arrived' : ''}`}
                          onContextMenu={(event) => openMessageMenu(event, message, 'channel')}>
                          {grouped ? <span className="message-avatar-spacer" /> : <Avatar user={message.author} size={34} />}
                          <div className="message-body">
                            {!grouped && <header><strong>{authorName}</strong><time data-tooltip={new Date(message.created_at).toLocaleString('ru-RU')}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header>}
                            {message.reply_to && <MessageReplyPreview replyTo={message.reply_to} onClick={() => document.getElementById(`nexo-channel-message-${message.reply_to!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />}
                            {message.content && <MessageContent content={message.content} />}
                            {message.pin && <small className="message-pinned-label"><Pin size={11} />Закреплено</small>}
                            {message.author.id === user.id && message.read_receipt && message.read_receipt.read_count > 0 && <small className="message-read-receipt">Прочитано {message.read_receipt.read_count}/{message.read_receipt.member_count}</small>}
                            {message.attachment && <AttachmentPreview attachment={message.attachment} />}
                            <MessageReactions reactions={message.reactions || []} userId={user.id} onToggle={(emoji) => void toggleMessageReaction(message, 'channel', emoji)} />
                          </div>
                        </article>
                      </Fragment>
                    );
                  })}
              </div>
              {replyingTo?.kind === 'channel' && (
                <div className="composer-editing-banner composer-replying-banner">
                  <span>Ответ для {replyingTo.message.author.display_name || replyingTo.message.author.username}: {replyingTo.message.content || 'Вложение'}</span>
                  <button type="button" className="link" onClick={() => setReplyingTo(null)}>Отмена</button>
                </div>
              )}
              {editingChannelMessageId !== null && (
                <div className="composer-editing-banner">
                  <span>Редактирование сообщения</span>
                  <button type="button" className="link" onClick={() => { setEditingChannelMessageId(null); setChannelComposer(''); }}>Отмена</button>
                </div>
              )}

              <div className="composer">
                <label className="file-pill">
                  <Paperclip size={16} />
                  <Input
                    type="file"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) setChannelUpload(file);
                    }}
                  />
                </label>
                <button type="button" className="composer-code-button" data-tooltip="Вставить блок кода" aria-label="Вставить блок кода" onClick={() => insertCodeBlock(true)}><Code size={16} /></button>
                <Textarea
                  ref={channelComposerRef}
                  placeholder={`Сообщение #${activeChannel.name}`}
                  value={channelComposer}
                  onChange={(event) => setChannelComposer(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSendChannelMessage(); } }}
                  onPaste={(event) => { const file = Array.from(event.clipboardData.files)[0]; if (file) { event.preventDefault(); setChannelUpload(file); } }}
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
        {showMembersPanel && (
          <aside className="channel-members-panel">
            <header><strong>Участники</strong><button type="button" className="ghost-icon" aria-label="Закрыть участников" data-tooltip="Закрыть" onClick={() => setShowMembersPanel(false)}><X size={15} /></button></header>
            {membersLoading && <p className="muted">Загружаем участников…</p>}
            {membersError && <p className="status error">{membersError}</p>}
            {!membersLoading && !membersError && <div className="channel-member-list">
              {serverMembers.map((member) => (
                <article key={member.id} className="channel-member-row">
                  <Avatar user={member.user} size={30} />
                  <div><strong>{member.nickname || member.user.display_name || member.user.username}</strong>
                    <small>@{member.user.username}</small>
                    <div className="channel-member-roles">
                      {member.role === 'owner' && <span className="owner-role">Владелец</span>}
                      {member.roles.map((role) => <span key={role.id} style={{ color: role.color }}>{role.name}</span>)}
                    </div>
                  </div>
                </article>
              ))}
              {serverMembers.length === 0 && <p className="muted">Список участников пуст.</p>}
            </div>}
          </aside>
        )}
      </div>
    );
  }

  return (
    <div className={'workspace-shell ' + (embedded ? 'workspace-shell-embedded' : '')}>
      {mode === 'servers' && showServersRail && !embedded && <ServersRail
        servers={servers}
        activeServerId={activeServerId}
        onSelectServer={(serverId) => { setMode('servers'); setActiveServerId(serverId); }}
        onCreateServer={() => setShowCreateServer(true)}
      />}
      <div className="workspace-main">
        {mode === 'friends' ? renderDirectMessages() : renderServerView()}
      </div>

      {messageContext && (
        <div className="message-context-backdrop" onPointerDown={() => setMessageContext(null)}>
          <div className="nexo-context-menu" style={{
            left: Math.min(messageContext.x, window.innerWidth - 220),
            top: Math.min(messageContext.y, window.innerHeight - 150)
          }} onPointerDown={(event) => event.stopPropagation()}>
            <div className="message-context-reactions" aria-label="Добавить реакцию">
              {['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'].map((emoji) => (
                <button key={emoji} type="button" data-tooltip={`Добавить реакцию ${emoji}`} onClick={() => void toggleMessageReaction(messageContext.message, messageContext.kind, emoji)}>{emoji}</button>
              ))}
            </div>
            <button type="button" onClick={() => void toggleMessagePin(messageContext.message, messageContext.kind)}>
              <Pin size={14} /><span>{messageContext.message.pin ? 'Открепить' : 'Закрепить'}</span>
            </button>
            <button type="button" onClick={() => beginReplyMessage(messageContext.message, messageContext.kind)}>
              <MessageCircle size={14} /><span>Ответить</span>
            </button>
            <button type="button" onClick={() => {
              const value = messageContext.message.content || messageContext.message.attachment?.name || '';
              void copyText(value);
              setMessageContext(null);
            }}><Copy size={14} /><span>Копировать текст</span></button>
            <button type="button" onClick={() => {
              const message = messageContext.message;
              const link = messageContext.kind === 'dm' && 'conversation_id' in message
                ? `nexo://dm/${message.conversation_id}/message/${message.id}`
                : `nexo://channel/${(message as ChannelMessage).server_id}/${(message as ChannelMessage).channel_id}/message/${message.id}`;
              void copyText(link);
              setMessageContext(null);
            }}><LinkIcon /><span>Копировать ссылку</span></button>
            {messageContext.message.author.id === user.id && (
              <>
                {messageContext.message.content && (
                  <button type="button" onClick={() => beginEditMessage(messageContext.message)}>
                    <Pencil size={14} /><span>Редактировать</span>
                  </button>
                )}
                <button type="button" className="danger" onClick={() => void deleteMessage(messageContext.message, messageContext.kind)}>
                  <X size={14} /><span>Удалить сообщение</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {incomingCall && (
        <motion.div ref={incomingCallBackdropRef} className="incoming-call-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.section className="incoming-call-card" role="dialog" aria-modal="true" aria-label="Входящий звонок"
            drag dragMomentum={false} dragElastic={0.04} dragConstraints={incomingCallBackdropRef}
            initial={{ opacity: 0, y: 18, scale: .92 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: .96 }} transition={{ type: 'spring', stiffness: 360, damping: 28 }}>
            <div className="incoming-call-avatar">
              <span className="incoming-call-pulse" />
              <Avatar user={incomingCall.user} size={88} showStatus />
            </div>
            <div className="incoming-call-copy">
              <strong>{incomingCall.user.display_name || incomingCall.user.username}</strong>
              <p>{incomingCall.groupTitle ? `${incomingCall.user.display_name || incomingCall.user.username} приглашает в звонок` : incomingCall.mediaType === 'video' ? 'Входящий видеозвонок' : 'Входящий голосовой звонок'}</p>
            </div>
            {incomingCall.mediaType === 'video' && <span className="incoming-call-video-label"><Monitor size={14} /> Видеозвонок</span>}
            {callState && <p className="incoming-call-busy-note">Вы уже в звонке. Принятие завершит текущий вызов.</p>}
            <button type="button" className="ringtone-toggle" onClick={() => setRingtoneMuted((value) => !value)}>
              {ringtoneMuted ? 'Включить звук звонка' : 'Отключить звук звонка'}
            </button>
            <div className="incoming-call-actions">
              <button type="button" className="call-reject" onClick={rejectIncomingCall} aria-label="Отклонить звонок" data-tooltip="Отклонить"><PhoneOff size={18} /><span>Отклонить</span></button>
              {incomingCall.mediaType === 'video' && <button type="button" className="call-accept call-accept-audio" onClick={() => void acceptIncomingCall('audio')} aria-label="Принять без видео" title="Принять без видео"><Phone size={18} /><span>Без видео</span></button>}
              <button type="button" className="call-accept" onClick={() => void acceptIncomingCall()} aria-label="Принять звонок" title={callState ? 'Принять и завершить текущий' : 'Принять'}><Phone size={18} /><span>Принять</span></button>
            </div>
          </motion.section>
        </motion.div>
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
    </div>
  );
}

function ServersRail({
  servers,
  activeServerId,
  onSelectServer,
  onCreateServer
}: {
  servers: Server[];
  activeServerId: number | null;
  onSelectServer: (serverId: number) => void;
  onCreateServer: () => void;
}) {
  return (
    <aside className="servers-rail" aria-label="Ваши пространства">
      <span className="servers-rail-label">ПРОСТРАНСТВА</span>
      {servers.map((server) => (
        <button key={server.id} type="button"
          className={`server-circle ${activeServerId === server.id ? 'active' : ''}`}
          onClick={() => onSelectServer(server.id)} title={server.name} aria-label={server.name}>
          {server.icon ? <img src={server.icon} alt="" /> : (server.name[0] || '?').toUpperCase()}
        </button>
      ))}
      <button type="button" className="server-circle ghost" onClick={onCreateServer} data-tooltip="Создать пространство" aria-label="Создать пространство"><Plus size={18} /></button>
    </aside>
  );
}

function ServerSidebar({
  server,
  activeChannelId,
  onSelectChannel,
  onOpenSettings
}: {
  server: Server;
  activeChannelId: number | null;
  onSelectChannel: (channelId: number) => void;
  onOpenSettings?: () => void;
}) {
  const textChannels = server.channels.filter((channel) => channel.type === 'text');
  const voiceChannels = server.channels.filter((channel) => channel.type !== 'text');
  return (
    <>
      <div className="channel-header">
        {server.name}
        <button type="button" className="ghost-icon" data-tooltip="Настройки пространства" onClick={onOpenSettings}>
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
          <div key={channel.id} className="channel voice channel-unavailable" data-tooltip="Голосовая связь в сообществах ещё не подключена">
            <Volume2 size={14} />{channel.name}<small>позже</small>
          </div>
        ))}
        {voiceChannels.length === 0 && <p className="muted">Добавьте голосовой канал.</p>}
      </div>
      <footer className="self-card">
        <div>
          <p>{server.role === 'owner' ? 'Вы — владелец' : 'Участник'}</p>
          <small>{server.description || 'Настройте сервер в любой момент'}</small>
        </div>
        <span className="self-status"><span className="status-dot" />В сети</span>
      </footer>
    </>
  );
}

function getMessageDayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function getMessageDayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const dayStamp = (item: Date) => new Date(item.getFullYear(), item.getMonth(), item.getDate()).getTime();
  if (dayStamp(date) === dayStamp(today)) return 'Сегодня';
  if (dayStamp(date) === dayStamp(yesterday)) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function copyText(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
  return Promise.resolve();
}

function InlineContent({ text }: { text: string }) {
  const expression = /`([^`]+)`|(https?:\/\/[^\s<>]+)/g;
  const parts: ReactNode[] = [];
  let last = 0, match: RegExpExecArray | null, key = 0;
  while ((match = expression.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      parts.push(<code key={key++} className="inline-code">{match[1]}</code>);
    } else if (match[2]) {
      const href = match[2].replace(/[),.!?]+$/, '');
      const suffix = match[2].slice(href.length);
      parts.push(<a key={key++} href={href} target="_blank" rel="noreferrer">{href}</a>, suffix);
    }
    last = expression.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function MessageReactions({ reactions, userId, onToggle }: {
  reactions: MessageReaction[];
  userId: number;
  onToggle: (emoji: string) => void;
}) {
  if (!reactions.length) return null;
  return (
    <div className="message-reactions" aria-label="Реакции на сообщение">
      {reactions.map((reaction) => (
        <button key={reaction.emoji} type="button"
          className={reaction.user_ids.includes(userId) ? 'message-reaction active' : 'message-reaction'} data-tooltip={reaction.user_ids.includes(userId) ? 'Убрать реакцию' : 'Добавить реакцию'}
          onClick={() => onToggle(reaction.emoji)}>
          <span>{reaction.emoji}</span><small>{reaction.count}</small>
        </button>
      ))}
    </div>
  );
}

function MessageReplyPreview({ replyTo, onClick }: { replyTo: MessageReply; onClick: () => void }) {
  return (
    <button type="button" className="message-reply-preview" onClick={onClick} data-tooltip="Перейти к исходному сообщению">
      <span className="message-reply-author">{replyTo.author.display_name || replyTo.author.username}</span>
      <span className="message-reply-content">{replyTo.content || 'Сообщение без текста'}</span>
    </button>
  );
}

function MessageContent({ content }: { content: string }) {
  const blocks = content.split(/```([a-zA-Z0-9_+.-]*)\n?([\s\S]*?)```/g);
  if (blocks.length === 1) {
    return <div className="message-content"><p><InlineContent text={content} /></p></div>;
  }
  const result: ReactNode[] = [];
  for (let index = 0; index < blocks.length; index += 3) {
    if (blocks[index]) result.push(<p key={`text-${index}`}><InlineContent text={blocks[index]} /></p>);
    const language = blocks[index + 1];
    const code = blocks[index + 2];
    if (code !== undefined) {
      result.push(<div className="message-code-block" key={`code-${index}`}>
        <header><span>{language || 'CODE'}</span><button type="button" data-tooltip="Копировать код" aria-label="Копировать код"
          onClick={() => void copyText(code.trimEnd())}><Copy size={13} />Копировать</button></header>
        <pre><code>{code.replace(/\n$/, '')}</code></pre>
      </div>);
    }
  }
  return <div className="message-content">{result}</div>;
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
  state, peer, currentUser, micMuted = false, onToggleMic, onHangUp, onShareScreen, onToggleCamera, audioOutputId, deafened
}: {
  state: CallState;
  peer: User | null;
  currentUser: User;
  micMuted?: boolean;
  onToggleMic?: () => void;
  onHangUp: (notifyRemote?: boolean) => void;
  onShareScreen: () => void;
  onToggleCamera: () => void;
  audioOutputId?: string;
  deafened?: boolean;
}) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [remoteVolume, setRemoteVolume] = useState(1);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [tileSize, setTileSize] = useState<'compact' | 'comfortable' | 'large'>('comfortable');
  const [clock, setClock] = useState(Date.now());
  const peerName = peer?.display_name || peer?.username || 'Собеседник';
  const cameraTrack = state.localStream?.getVideoTracks()[0];
  const cameraEnabled = Boolean(cameraTrack?.enabled && !state.isScreenSharing);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await overlayRef.current?.requestFullscreen?.();
    } catch (error) { console.warn('Fullscreen call view is unavailable:', error); }
  }
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === overlayRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    state.localStream?.getAudioTracks().forEach((track) => { void track.applyConstraints({ noiseSuppression }).catch(() => {}); });
  }, [state.localStream, noiseSuppression]);

  useEffect(() => {
    if (localVideoRef.current && state.localStream) localVideoRef.current.srcObject = state.localStream;
  }, [state.localStream]);
  useEffect(() => {
    if (remoteVideoRef.current && state.remoteStream) remoteVideoRef.current.srcObject = state.remoteStream;
    if (remoteAudioRef.current && state.remoteStream) remoteAudioRef.current.srcObject = state.remoteStream;
  }, [state.remoteStream]);
  useEffect(() => {
    const output = (remoteAudioRef.current || remoteVideoRef.current) as (HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (output?.setSinkId && audioOutputId) void output.setSinkId(audioOutputId).catch((error) => console.warn('Audio output selection failed:', error));
  }, [audioOutputId, state.remoteStream]);

  useEffect(() => {
    if (remoteAudioRef.current) remoteAudioRef.current.volume = remoteVolume;
    if (remoteVideoRef.current) remoteVideoRef.current.volume = remoteVolume;
  }, [remoteVolume, state.remoteStream]);

  const total = Math.max(0, Math.floor((clock - state.startedAt) / 1000));
  const duration = `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
  if (collapsed) return (
    <div className="call-overlay-collapsed">
      <span className="call-live-dot" />
      <strong>Звонок · {peerName} · {duration}</strong>
      <button type="button" className="ghost tiny" onClick={() => setCollapsed(false)}><ChevronUp size={14} />Развернуть</button>
      <button type="button" className="call-hangup-small" onClick={() => onHangUp(true)} aria-label="Завершить звонок"><PhoneOff size={16} /></button>
    </div>
  );

  return (
    <motion.section className="call-overlay"
      initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
      <div className="call-banner-participants">
        <div className="call-banner-person connected"><Avatar user={currentUser} size={64} showStatus /><small>Вы</small></div>
        <div className={state.remoteStream ? 'call-banner-person connected' : 'call-banner-person pending'}><Avatar user={peer} size={64} showStatus /><small>{peerName}</small></div>
      </div>
      {state.remoteStream && !state.remoteStream.getVideoTracks().length && <audio ref={remoteAudioRef} className="call-audio-sink" autoPlay playsInline muted={deafened} />}
      {(state.remoteStream?.getVideoTracks().length || cameraTrack) ? <div className={`call-banner-media ${tileSize}`}>
        {state.remoteStream?.getVideoTracks().length ? <video ref={remoteVideoRef} autoPlay playsInline muted={deafened} /> : null}
        {cameraTrack && <video ref={localVideoRef} className="call-local-preview" autoPlay playsInline muted />}
      </div> : null}
      <div className="call-banner-controls">
        <div className="call-control-group">
          <button type="button" className={micMuted ? 'call-control danger' : 'call-control'} onClick={onToggleMic} data-tooltip={micMuted ? 'Включить микрофон' : 'Выключить микрофон'} aria-label={micMuted ? 'Включить микрофон' : 'Выключить микрофон'}>
            {micMuted ? <MicOff size={17} /> : <Mic size={17} />}
          </button>
          <button type="button" className={cameraEnabled ? 'call-control' : 'call-control danger'} onClick={onToggleCamera}
            disabled={!cameraTrack || state.isScreenSharing} data-tooltip={cameraEnabled ? 'Выключить камеру' : 'Включить камеру'} aria-label={cameraEnabled ? 'Выключить камеру' : 'Включить камеру'}>
            {cameraEnabled ? <Camera size={17} /> : <CameraOff size={17} />}
          </button>
        </div>
        <div className="call-control-group">
          <button type="button" className="call-control" onClick={onShareScreen} data-tooltip="Поделиться экраном" aria-label="Поделиться экраном"><Monitor size={17} /></button>
          <div className="call-more-wrap">
            <button type="button" className="call-control" onClick={() => setMoreOpen((value) => !value)} data-tooltip="Дополнительные настройки" aria-label="Дополнительные настройки"><MoreHorizontal size={17} /></button>
            {moreOpen && <div className="call-more-popover">
              <div><span>Шумоподавление</span><Switch checked={noiseSuppression} onChange={setNoiseSuppression} label="Шумоподавление" /></div>
              <Slider label="Громкость собеседника" min={0} max={1} step={0.05} value={remoteVolume} valueLabel={`${Math.round(remoteVolume * 100)}%`} onChange={setRemoteVolume} />
              <label><span>Размер плитки</span><Select value={tileSize} onChange={(event) => setTileSize(event.target.value as typeof tileSize)}><option value="compact">Компактный</option><option value="comfortable">Обычный</option><option value="large">Крупный</option></Select></label>
            </div>}
          </div>
          <button type="button" className="call-control" onClick={() => void toggleFullscreen()} title={fullscreen ? 'Свернуть звонок' : 'Развернуть звонок'} aria-label={fullscreen ? 'Свернуть звонок' : 'Развернуть звонок'}>{fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
          <button type="button" className="call-control" onClick={() => setCollapsed(true)} title="Свернуть панель звонка" aria-label="Свернуть панель звонка"><ChevronUp size={17} /></button>
        </div>
        <button type="button" className="call-control call-hangup" onClick={() => onHangUp(true)} title="Завершить звонок" aria-label="Завершить звонок"><PhoneOff size={17} /></button>
      </div>
      <span className="call-banner-duration">{duration}</span>
    </motion.section>
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
            <Input
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
            <Textarea
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

