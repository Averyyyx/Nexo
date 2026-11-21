import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Home, Users, MessageCircle, Settings, Plus, X, ChevronDown, ChevronRight,
  ChevronLeft, ChevronRight as ChevronRightIcon, Pin, Search, Command,
  Phone, PhoneOff, Mic, MicOff, Headphones, HeadphoneOff, Camera, MonitorUp, Lock, LogOut, Moon,
  Sun, Monitor, MoreHorizontal, CornerDownLeft, UserRoundPlus, FolderPlus, RefreshCw, Keyboard,
  PanelLeftClose, PanelLeftOpen, Check, Volume2, Circle,
} from 'lucide-react';
import { LoginPanel } from './components/LoginPanel';
import { ProfileSetup } from './components/ProfileSetup';
import { MessengerWorkspace } from './components/MessengerWorkspace';
import { VoiceRoom } from './components/VoiceRoom';
import { Field, Input, Select, Textarea, Button } from './components/ui';
import { FriendsPanel } from './components/FriendsPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Avatar } from './components/Avatar';
import { DefaultAvatar } from './components/DefaultAvatar';
import { apiFetch } from './lib/api';
import { applyTheme, isThemeChoice, type ThemeChoice } from './lib/theme';
import { loadingPhrases } from './lib/phrases';
import { playNexoSound } from './lib/sounds';
import { getSocket } from './lib/socket';
import type { ChannelMessage, Conversation, FriendPayload, Message, Server, User, UserStatus } from './types';

type TabKind = 'home' | 'friends' | 'dm' | 'channel' | 'voice' | 'settings';
type WorkspaceTab = {
  id: string;
  kind: TabKind;
  title: string;
  targetId?: number;
  serverId?: number;
  channelId?: number;
  messageId?: number;
  initialSection?: 'account' | 'profile' | 'appearance' | 'notifications' | 'voice' | 'hotkeys' | 'accessibility' | 'premium' | 'servers' | 'updates';
  pinned?: boolean;
  unread?: number;
};
type SidebarPin = { id: string; kind: 'dm' | 'channel'; title: string; targetId: number; serverId?: number; channelId?: number };
type PaletteEntry = { id: string; title: string; subtitle?: string; group: string; icon: ReactNode; run: () => void };
type ContextState = { x: number; y: number; tabId?: string; target?: SidebarPin; server?: Server } | null;
type StatusChoice = { value: UserStatus; label: string };
type IncomingCallInfo = { conversationId: number; from: number; user: User; mediaType: 'audio' | 'video'; groupTitle?: string };
type VoiceInviteInfo = { serverId: number; channelId: number; serverName: string; channelName: string; from: number; user: User };
type DeepLinkPayload = { type: 'dm'; conversationId: number; messageId?: number } | { type: 'channel'; serverId: number; channelId: number; messageId?: number };
type ActiveCallInfo = { conversationId: number; title: string; startedAt: number };


const tabHome: WorkspaceTab = { id: 'home', kind: 'home', title: 'Главная', pinned: true };
const statusChoices: StatusChoice[] = [
  { value: 'online', label: 'В сети' },
  { value: 'idle', label: 'Отошёл' },
  { value: 'dnd', label: 'Не беспокоить' },
  { value: 'invisible', label: 'Невидимка' }
];

function tabStorageKey(userId: number) { return `nexo.tabs.v1.${userId}`; }
function pinStorageKey(userId: number) { return `nexo.pins.v1.${userId}`; }
function sidebarStorageKey(userId: number) { return `nexo.sidebar-width.v1.${userId}`; }
function unreadStorageKey(userId: number) { return `nexo.unreads.v1.${userId}`; }

function countUserMentions(content: string, username: string): number {
  const needle = `@${username.trim().toLocaleLowerCase('en-US')}`;
  if (!content || needle === '@') return 0;
  const source = content.toLocaleLowerCase('en-US');
  const isWord = (character: string) => /[a-z0-9_]/i.test(character);
  let count = 0;
  let cursor = 0;
  while ((cursor = source.indexOf(needle, cursor)) !== -1) {
    const before = cursor > 0 ? source[cursor - 1] : '';
    const after = source[cursor + needle.length] || '';
    if (!isWord(before) && !isWord(after)) count += 1;
    cursor += needle.length;
  }
  return count;
}

function fuzzyMatch(text: string, query: string) {
  const source = text.toLocaleLowerCase('ru-RU');
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  if (!needle) return true;
  if (source.includes(needle)) return true;
  let cursor = 0;
  for (const character of needle) {
    cursor = source.indexOf(character, cursor);
    if (cursor < 0) return false;
    cursor += 1;
  }
  return true;
}

export default function App() {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceRestored, setWorkspaceRestored] = useState(false);
  const [loadingError, setLoadingError] = useState('');
  const [loadingPhraseIndex, setLoadingPhraseIndex] = useState(() => Math.floor(Math.random() * loadingPhrases.length));
  const [bootAttempt, setBootAttempt] = useState(0);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([tabHome]);
  const [activeTabId, setActiveTabId] = useState('home');
  const [closedTabs, setClosedTabs] = useState<WorkspaceTab[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friends, setFriends] = useState<FriendPayload>({ incoming: [], outgoing: [], friends: [] });
  const [servers, setServers] = useState<Server[]>([]);
  const [unreadDmCounts, setUnreadDmCounts] = useState<Record<number, number>>({});
  const [unreadChannelCounts, setUnreadChannelCounts] = useState<Record<number, number>>({});
  const [unreadDmMentionCounts, setUnreadDmMentionCounts] = useState<Record<number, number>>({});
  const [unreadChannelMentionCounts, setUnreadChannelMentionCounts] = useState<Record<number, number>>({});
  const [expandedServers, setExpandedServers] = useState<number[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<string[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteActiveIndex, setPaletteActiveIndex] = useState(0);
  const [paletteMode, setPaletteMode] = useState<'all' | 'new-message'>('all');
  const [contextMenu, setContextMenu] = useState<ContextState>(null);
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [createSpaceName, setCreateSpaceName] = useState('');
  const [createSpaceDescription, setCreateSpaceDescription] = useState('');
  const [createSpaceStatus, setCreateSpaceStatus] = useState('');
  const [createChannelServerId, setCreateChannelServerId] = useState<number | null>(null);
  const [createChannelName, setCreateChannelName] = useState('');
  const [createChannelTopic, setCreateChannelTopic] = useState('');
  const [createChannelType, setCreateChannelType] = useState<'text' | 'voice'>('text');
  const [createChannelStatus, setCreateChannelStatus] = useState('');
  const [channelEditTarget, setChannelEditTarget] = useState<SidebarPin | null>(null);
  const [channelEditName, setChannelEditName] = useState('');
  const [channelEditTopic, setChannelEditTopic] = useState('');
  const [channelEditStatus, setChannelEditStatus] = useState('');
  const [channelDeleteConfirm, setChannelDeleteConfirm] = useState(false);
  const [welcomeKind, setWelcomeKind] = useState<'back' | 'new' | null>(null);
  const [welcomeName, setWelcomeName] = useState('');
  const [micMuted, setMicMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [savedMicMuted, setSavedMicMuted] = useState(false);
  const [audioInputId, setAudioInputId] = useState('');
  const [audioOutputId, setAudioOutputId] = useState('');
  const [videoInputId, setVideoInputId] = useState('');
  const [notificationUpdate, setNotificationUpdate] = useState<{ version: string; message: string } | null>(null);
  const [pendingIncomingCall, setPendingIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [pendingVoiceInvite, setPendingVoiceInvite] = useState<VoiceInviteInfo | null>(null);
  const [pendingDeepLink, setPendingDeepLink] = useState<DeepLinkPayload | null>(null);
  const [activeCallInfo, setActiveCallInfo] = useState<ActiveCallInfo | null>(null);
  const [callClock, setCallClock] = useState(Date.now());
  const [activeVoiceInfo, setActiveVoiceInfo] = useState<{ serverId: number; channelId: number; serverName: string; channelName: string; joinedAt: number } | null>(null);
  const [voiceClock, setVoiceClock] = useState(Date.now());
  const [voiceParticipantsByChannel, setVoiceParticipantsByChannel] = useState<Record<number, Array<{ user: { id: number; username: string; display_name: string; avatar_url: string; avatar_color?: string }; muted: boolean; deafened: boolean; canSpeak?: boolean }>>>({});
  const [voiceSpeakingByChannel, setVoiceSpeakingByChannel] = useState<Record<number, number[]>>({});
  const [createChannelUserLimit, setCreateChannelUserLimit] = useState(8);
  const [appVersion, setAppVersion] = useState('0.0.8-alpha');

  const desktopApi = typeof window !== 'undefined' ? window.nexoAPI : undefined;
  const tabStripRef = useRef<HTMLDivElement>(null);
  const tabNodeRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const resizeRef = useRef<{ startX: number; width: number; initialWidth: number } | null>(null);
  const welcomeTimerRef = useRef<number | null>(null);
  const lastActivityRef = useRef(Date.now());
  const wasManuallySetStatusRef = useRef(false);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabHome;
  const unreadRequests = friends.incoming.length;
  const serverUnreadCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const server of servers) counts[server.id] = server.channels.reduce((total, channel) => total + (unreadChannelCounts[channel.id] || 0), 0);
    return counts;
  }, [servers, unreadChannelCounts]);
  const unreadTotal = useMemo(() => Math.min(9, unreadRequests + Object.values(unreadDmCounts).reduce((sum, count) => sum + count, 0) + Object.values(unreadChannelCounts).reduce((sum, count) => sum + count, 0)), [unreadRequests, unreadDmCounts, unreadChannelCounts]);
  const currentTitle = activeTab.title;

  useEffect(() => {
    desktopApi?.getAppVersion?.().then(setAppVersion).catch(() => {});
  }, [desktopApi]);

  useEffect(() => {
    const onVoiceState = (event: Event) => {
      const detail = (event as CustomEvent<{ active: boolean; serverId?: number; channelId?: number; serverName?: string; channelName?: string; joinedAt?: number }>).detail;
      if (detail?.active && detail.serverId && detail.channelId) {
        document.documentElement.dataset.nexoVoiceActive = 'true';
        document.documentElement.dataset.nexoVoiceChannelId = String(detail.channelId);
        setActiveVoiceInfo({ serverId: detail.serverId, channelId: detail.channelId, serverName: detail.serverName || '', channelName: detail.channelName || '', joinedAt: detail.joinedAt || Date.now() });
      } else if (!detail?.active) {
        delete document.documentElement.dataset.nexoVoiceActive;
        delete document.documentElement.dataset.nexoVoiceChannelId;
        setActiveVoiceInfo((current) => current && (detail?.channelId === undefined || detail.channelId === current.channelId) ? null : current);
      }
    };
    const onVoiceSpeaking = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId: number; userIds: number[] }>).detail;
      if (detail?.channelId) setVoiceSpeakingByChannel((current) => ({ ...current, [detail.channelId]: detail.userIds || [] }));
    };
    const onVoiceParticipants = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId: number; participants: Array<{ user: { id: number; username: string; display_name: string; avatar_url: string; avatar_color?: string }; muted: boolean; deafened: boolean; canSpeak?: boolean }> }>).detail;
      if (detail?.channelId) setVoiceParticipantsByChannel((current) => ({ ...current, [detail.channelId]: detail.participants || [] }));
    };
    window.addEventListener('nexo-voice-state', onVoiceState);
    window.addEventListener('nexo-voice-participants', onVoiceParticipants);
    window.addEventListener('nexo-voice-speaking', onVoiceSpeaking);
    return () => { window.removeEventListener('nexo-voice-state', onVoiceState); window.removeEventListener('nexo-voice-participants', onVoiceParticipants); window.removeEventListener('nexo-voice-speaking', onVoiceSpeaking); };
  }, []);

  useEffect(() => {
    if (!activeVoiceInfo) return;
    const timer = window.setInterval(() => setVoiceClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeVoiceInfo]);

  useEffect(() => {
    desktopApi?.setNotificationCount?.(unreadTotal);
  }, [desktopApi, unreadTotal]);

  useEffect(() => {
    applyTheme(theme);
    desktopApi?.setWindowTheme?.(theme);
  }, [theme, desktopApi]);

  useEffect(() => {
    if (user?.status === 'dnd') document.documentElement.dataset.nexoDnd = 'true';
    else delete document.documentElement.dataset.nexoDnd;
    return () => { delete document.documentElement.dataset.nexoDnd; };
  }, [user?.status]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => {
      setLoadingPhraseIndex((current) => {
        let next = Math.floor(Math.random() * loadingPhrases.length);
        if (next === current) next = (next + 1) % loadingPhrases.length;
        return next;
      });
    }, 2200);
    return () => window.clearInterval(timer);
  }, [loading]);

  const loadWorkspaceData = useCallback(async (currentUser: User) => {
    const [conversationResponse, friendResponse, serverResponse] = await Promise.all([
      apiFetch('/api/conversations'),
      apiFetch('/api/friends'),
      apiFetch('/api/servers')
    ]);
    if (!conversationResponse.ok || !friendResponse.ok || !serverResponse.ok) {
      throw new Error('Не удалось загрузить рабочее пространство.');
    }
    const [conversationPayload, friendPayload, serverPayload] = await Promise.all([
      conversationResponse.json(), friendResponse.json(), serverResponse.json()
    ]);
    const nextConversations = (conversationPayload.conversations || []) as Conversation[];
    const nextFriends = friendPayload as FriendPayload;
    const nextServers = (serverPayload.servers || []) as Server[];
    setConversations(nextConversations);
    setFriends(nextFriends);
    setServers(nextServers);

    const savedRaw = localStorage.getItem(tabStorageKey(currentUser.id));
    if (savedRaw) {
      try {
        const saved = JSON.parse(savedRaw) as { tabs?: WorkspaceTab[]; activeTabId?: string };
        const validTabs = (saved.tabs || []).filter((tab) => {
          if (tab.kind === 'home' || tab.kind === 'friends' || tab.kind === 'settings') return true;
          if (tab.kind === 'dm') return nextConversations.some((conversation) => conversation.id === tab.targetId);
          if (tab.kind === 'channel' || tab.kind === 'voice') {
            const server = nextServers.find((item) => item.id === tab.serverId);
            return Boolean(server?.channels.some((channel) => channel.id === tab.channelId && (tab.kind !== 'voice' || channel.type === 'voice')));
          }
          return false;
        });
        const restored = [tabHome, ...validTabs.filter((tab) => tab.kind !== 'home' && tab.id !== 'home')];
        setTabs(restored);
        setActiveTabId(restored.some((tab) => tab.id === saved.activeTabId) ? saved.activeTabId! : 'home');
      } catch {
        setTabs([tabHome]);
        setActiveTabId('home');
      }
    }
    const savedPins = localStorage.getItem(pinStorageKey(currentUser.id));
    if (savedPins) {
      try {
        const pins = JSON.parse(savedPins) as SidebarPin[];
        setPinnedItems(pins.filter((pin) => pin.kind === 'dm'
          ? nextConversations.some((item) => item.id === pin.targetId)
          : nextServers.some((server) => server.id === pin.serverId && server.channels.some((channel) => channel.id === pin.channelId))));
      } catch { setPinnedItems([]); }
    }
    const savedWidth = Number(localStorage.getItem(sidebarStorageKey(currentUser.id)));
    if (Number.isFinite(savedWidth) && savedWidth >= 220 && savedWidth <= 360) setSidebarWidth(savedWidth);

    // Socket is part of the first-run barrier: don't remove it from hidden tab contents.
    const socket = getSocket();
    await new Promise<void>((resolve) => {
      if (socket.connected) return resolve();
      const timeout = window.setTimeout(resolve, 2600);
      socket.once('socket:ready', () => { window.clearTimeout(timeout); resolve(); });
      socket.once('connect_error', () => { window.clearTimeout(timeout); resolve(); });
    });
    setWorkspaceRestored(true);
  }, []);

  const [pinnedItems, setPinnedItems] = useState<SidebarPin[]>([]);

  useEffect(() => {
    let cancelled = false;
    const startAt = Date.now();
    const maximumTimer = window.setTimeout(() => {
      if (!cancelled) {
        setLoadingError('Запуск занял слишком много времени. Проверьте подключение к серверу.');
        setLoading(false);
      }
    }, 12000);
    async function bootstrap() {
      setLoading(true);
      setLoadingError('');
      try {
        const sessionResponse = await apiFetch('/api/auth/session');
        if (!sessionResponse.ok) throw new Error('Не удалось связаться с сервером Nexo.');
        const payload = await sessionResponse.json();
        const currentUser = payload.user as User | null;
        if (cancelled) return;
        if (currentUser) {
          setUser(currentUser);
          const settingsResponse = await apiFetch('/api/settings/me');
          if (!settingsResponse.ok) throw new Error('Не удалось загрузить настройки аккаунта.');
          const settingsPayload = await settingsResponse.json();
          const savedTheme = settingsPayload.settings?.theme;
          if (isThemeChoice(savedTheme)) setTheme(savedTheme);
          await loadWorkspaceData(currentUser);
        } else {
          setUser(null);
        }
        const elapsed = Date.now() - startAt;
        if (elapsed < 1600) await new Promise((resolve) => window.setTimeout(resolve, 1600 - elapsed));
        if (!cancelled) setLoading(false);
      } catch (error) {
        if (!cancelled) {
          setLoadingError((error as Error).message || 'Не удалось загрузить Nexo.');
          setLoading(false);
        }
      } finally {
        window.clearTimeout(maximumTimer);
      }
    }
    void bootstrap();
    return () => { cancelled = true; window.clearTimeout(maximumTimer); };
  }, [bootAttempt, loadWorkspaceData]);

  useEffect(() => {
    if (!user || !workspaceRestored) return;
    try {
      localStorage.setItem(tabStorageKey(user.id), JSON.stringify({ tabs, activeTabId }));
      localStorage.setItem(pinStorageKey(user.id), JSON.stringify(pinnedItems));
    } catch { /* private mode or quota reached */ }
  }, [tabs, activeTabId, pinnedItems, user, workspaceRestored]);

  useEffect(() => {
    if (!user || !workspaceRestored) return;
    try {
      const saved = JSON.parse(localStorage.getItem(unreadStorageKey(user.id)) || '{}') as { dm?: Record<string, number>; channels?: Record<string, number>; dmMentions?: Record<string, number>; channelMentions?: Record<string, number> };
      const normalize = (value?: Record<string, number>): Record<number, number> => {
        const entries: Array<[string, number]> = Object.entries(value || {}).map(([key, count]) => [
          key, Math.max(0, Math.min(99, Math.floor(Number(count) || 0)))
        ]);
        return Object.fromEntries(entries.filter(([, count]) => count > 0)) as Record<number, number>;
      };
      setUnreadDmCounts(normalize(saved.dm));
      setUnreadChannelCounts(normalize(saved.channels));
      setUnreadDmMentionCounts(normalize(saved.dmMentions));
      setUnreadChannelMentionCounts(normalize(saved.channelMentions));
    } catch { /* Ignore a damaged local unread cache */ }
  }, [user?.id, workspaceRestored]);

  useEffect(() => {
    if (!user || !workspaceRestored) return;
    try {
      localStorage.setItem(unreadStorageKey(user.id), JSON.stringify({ dm: unreadDmCounts, channels: unreadChannelCounts, dmMentions: unreadDmMentionCounts, channelMentions: unreadChannelMentionCounts }));
    } catch { /* Storage may be unavailable */ }
  }, [user?.id, workspaceRestored, unreadDmCounts, unreadChannelCounts, unreadDmMentionCounts, unreadChannelMentionCounts]);

  useEffect(() => {
    if (!user) return;
    const savedInput = localStorage.getItem(`nexo.audio-input.${user.id}`) || '';
    const savedOutput = localStorage.getItem(`nexo.audio-output.${user.id}`) || '';
    const savedVideo = localStorage.getItem(`nexo.video-input.${user.id}`) || '';
    const savedMic = localStorage.getItem(`nexo.mic-muted.${user.id}`) === 'true';
    setAudioInputId(savedInput);
    setAudioOutputId(savedOutput);
    setVideoInputId(savedVideo);
    setMicMuted(savedMic);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    const onUserUpdate = ({ user: updated }: { user: User }) => {
      if (!updated) return;
      setConversations((current) => current.map((conversation) => ({
        ...conversation,
        counterpart: conversation.counterpart?.id === updated.id ? updated : conversation.counterpart,
        participants: conversation.participants.map((participant) => participant.id === updated.id ? updated : participant),
        title: conversation.counterpart?.id === updated.id ? (updated.display_name || updated.username) : conversation.title
      })));
      setFriends((current) => ({
        incoming: current.incoming.map((item) => item.user.id === updated.id ? { ...item, user: updated } : item),
        outgoing: current.outgoing.map((item) => item.user.id === updated.id ? { ...item, user: updated } : item),
        friends: current.friends.map((item) => item.user.id === updated.id ? { ...item, user: updated } : item)
      }));
      setUser((current) => current?.id === updated.id ? { ...current, ...updated } : current);
      setTabs((current) => current.map((tab) => {
        const conversation = conversations.find((item) => item.id === tab.targetId);
        const counterpart = conversation?.counterpart || conversation?.participants.find((participant) => participant.id !== user.id);
        return tab.kind === 'dm' && counterpart?.id === updated.id
          ? { ...tab, title: updated.display_name || updated.username }
          : tab;
      }));
    };
    socket.on('user:update', onUserUpdate);
    return () => { socket.off('user:update', onUserUpdate); };
  }, [user?.id, conversations]);

  useEffect(() => {
    if (!desktopApi?.onDeepLink) return;
    return desktopApi.onDeepLink((payload) => setPendingDeepLink(payload));
  }, [desktopApi]);

  useEffect(() => {
    if (!pendingDeepLink || !user || !workspaceRestored) return;
    const payload = pendingDeepLink;
    if (payload.type === 'dm') {
      const conversation = conversations.find((item) => item.id === payload.conversationId);
      if (conversation) openDmTab(conversation, false, payload.messageId);
      else { setPendingDeepLink(null); return; }
    } else {
      const server = servers.find((item) => item.id === payload.serverId);
      if (server) openChannelTab(server, payload.channelId, false, payload.messageId);
      else { setPendingDeepLink(null); return; }
    }
    if (payload.messageId) {
      const messageElementId = payload.type === 'dm'
        ? `nexo-message-${payload.messageId}`
        : `nexo-channel-message-${payload.messageId}`;
      window.setTimeout(() => document.getElementById(messageElementId)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 420);
    }
    setPendingDeepLink(null);
  }, [pendingDeepLink, user, workspaceRestored, conversations, servers]);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    const onCallInvite = (payload: IncomingCallInfo) => {
      if (!payload || payload.user?.id === user.id) return;
      const conversation = conversations.find((item) => item.id === payload.conversationId);
      const nextPayload = {
        ...payload,
        groupTitle: conversation?.type === 'group' ? (conversation.title || 'Групповой звонок') : undefined
      };
      setPendingIncomingCall(nextPayload);
      if (conversation) openDmTab(conversation);
      if (user.status !== 'dnd' && (!document.hasFocus() || document.visibilityState !== 'visible')) {
        void desktopApi?.showNotification?.({
          title: nextPayload.user.display_name || nextPayload.user.username,
          body: payload.mediaType === 'video' ? 'Входящий видеозвонок' : 'Входящий голосовой звонок',
          deepLink: `nexo://dm/${payload.conversationId}`
        })?.catch(() => {});
      }
    };
    const onVoiceInvite = (payload: VoiceInviteInfo) => {
      if (!payload || payload.user?.id === user.id) return;
      setPendingVoiceInvite(payload);
    };
    socket.on('call:ring', onCallInvite);
    socket.on('voice:invite', onVoiceInvite);
    return () => { socket.off('call:ring', onCallInvite); socket.off('voice:invite', onVoiceInvite); };
  }, [user?.id, user?.status, conversations, desktopApi]);

  useEffect(() => {
    const onCallState = (event: Event) => {
      const detail = (event as CustomEvent<{ active: boolean; conversationId?: number; title?: string; startedAt?: number }>).detail;
      if (!detail?.active || !detail.conversationId) setActiveCallInfo(null);
      else setActiveCallInfo({
        conversationId: detail.conversationId,
        title: detail.title || 'Личный звонок',
        startedAt: detail.startedAt || Date.now()
      });
    };
    window.addEventListener('nexo-call-state', onCallState);
    return () => window.removeEventListener('nexo-call-state', onCallState);
  }, []);

  useEffect(() => {
    if (!activeCallInfo) return;
    const timer = window.setInterval(() => setCallClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeCallInfo]);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    const onMessage = ({ conversationId, message }: { conversationId: number; message?: Message }) => {
      if (message?.author?.id === user.id) return;
      if (message?.id) {
        void apiFetch(`/api/conversations/${conversationId}/delivered`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageIds: [message.id] })
        }).catch(() => {});
      }
      const id = `dm:${conversationId}`;
      const isVisibleConversation = id === activeTabId && document.visibilityState === 'visible' && document.hasFocus();
      if (!isVisibleConversation) {
        setUnreadDmCounts((current) => ({ ...current, [conversationId]: Math.min(99, (current[conversationId] || 0) + 1) }));
        const mentions = countUserMentions(message?.content || '', user.username);
        if (mentions > 0) setUnreadDmMentionCounts((current) => ({ ...current, [conversationId]: Math.min(99, (current[conversationId] || 0) + mentions) }));
        playNexoSound(mentions > 0 ? 'notification' : 'message');
        if (user.status !== 'dnd' && message && (!document.hasFocus() || document.visibilityState !== 'visible')) {
          const conversation = conversations.find((item) => item.id === conversationId);
          const title = conversation?.counterpart?.display_name || conversation?.counterpart?.username || 'Новое сообщение';
          void desktopApi?.showNotification?.({
            title: mentions > 0 ? `Упоминание · ${title}` : title,
            body: message.content || (message.attachment ? 'Отправлено вложение' : 'Новое сообщение'),
            deepLink: `nexo://dm/${conversationId}/message/${message.id}`
          })?.catch(() => {});
        }
      }
      setTabs((current) => current.map((tab) => tab.id === id && tab.id !== activeTabId
        ? { ...tab, unread: (tab.unread || 0) + 1 }
        : tab));
      const existing = conversations.find((conversation) => conversation.id === conversationId);
      if (existing) setConversations((current) => [existing, ...current.filter((item) => item.id !== conversationId)]);
    };
    const onChannelMessage = ({ channelId, message }: { channelId: number; message?: ChannelMessage }) => {
      if (message?.author?.id === user.id) return;
      const id = `channel:${channelId}`;
      const isVisibleChannel = id === activeTabId && document.visibilityState === 'visible' && document.hasFocus();
      if (!isVisibleChannel) {
        setUnreadChannelCounts((current) => ({ ...current, [channelId]: Math.min(99, (current[channelId] || 0) + 1) }));
        const mentions = countUserMentions(message?.content || '', user.username);
        if (mentions > 0) setUnreadChannelMentionCounts((current) => ({ ...current, [channelId]: Math.min(99, (current[channelId] || 0) + mentions) }));
        playNexoSound(mentions > 0 ? 'notification' : 'message');
        if (user.status !== 'dnd' && message) {
          const server = servers.find((item) => item.id === message.server_id);
          const channel = server?.channels.find((item) => item.id === channelId);
          const title = server && channel ? `${server.name} · #${channel.name}` : 'Новое сообщение в пространстве';
          void desktopApi?.showNotification?.({
            title: mentions > 0 ? `Упоминание · ${title}` : title,
            body: message.content || (message.attachment ? 'Отправлено вложение' : 'Новое сообщение'),
            deepLink: `nexo://channel/${message.server_id}/${channelId}/message/${message.id}`
          })?.catch(() => {});
        }
      }
      setTabs((current) => current.map((tab) => tab.id === id && tab.id !== activeTabId
        ? { ...tab, unread: (tab.unread || 0) + 1 }
        : tab));
    };
    const onServerUpsert = ({ server }: { server: Server }) => {
      setServers((current) => current.some((item) => item.id === server.id)
        ? current.map((item) => item.id === server.id ? server : item)
        : [server, ...current]);
    };
    const onChannelDeleted = ({ serverId, channelId }: { serverId: number; channelId: number }) => {
      setServers((current) => current.map((server) => server.id === serverId
        ? { ...server, channels: server.channels.filter((channel) => channel.id !== channelId) }
        : server));
      setTabs((current) => current.filter((tab) => tab.channelId !== channelId));
      setPinnedItems((current) => current.filter((item) => item.channelId !== channelId));
      setActiveTabId((current) => current === `channel:${channelId}` ? 'home' : current);
    };
    const onServerLeave = ({ serverId }: { serverId: number }) => {
      setServers((current) => current.filter((server) => server.id !== serverId));
      setTabs((current) => current.filter((tab) => tab.serverId !== serverId));
      setPinnedItems((current) => current.filter((item) => item.serverId !== serverId));
      setActiveTabId((current) => {
        const tab = tabs.find((item) => item.id === current);
        return tab?.serverId === serverId ? 'home' : current;
      });
    };
    socket.on('message:notify', onMessage);
    socket.on('channel:message:notify', onChannelMessage);
    socket.on('server:upsert', onServerUpsert);
    socket.on('channel:deleted', onChannelDeleted);
    socket.on('server:leave', onServerLeave);
    return () => {
      socket.off('message:notify', onMessage);
      socket.off('channel:message:notify', onChannelMessage);
      socket.off('server:upsert', onServerUpsert);
      socket.off('channel:deleted', onChannelDeleted);
      socket.off('server:leave', onServerLeave);
    };
  }, [user, activeTabId, conversations, tabs, servers, desktopApi]);

  useEffect(() => {
    if (!activeTabId) return;
    setTabs((current) => current.map((tab) => tab.id === activeTabId && tab.unread ? { ...tab, unread: 0 } : tab));
    if (activeTab.kind === 'dm' && activeTab.targetId) setUnreadDmCounts((current) => current[activeTab.targetId!] ? { ...current, [activeTab.targetId!]: 0 } : current);
    if (activeTab.kind === 'dm' && activeTab.targetId) setUnreadDmMentionCounts((current) => current[activeTab.targetId!] ? { ...current, [activeTab.targetId!]: 0 } : current);
    if (activeTab.kind === 'channel' && activeTab.channelId) setUnreadChannelCounts((current) => current[activeTab.channelId!] ? { ...current, [activeTab.channelId!]: 0 } : current);
    if (activeTab.kind === 'channel' && activeTab.channelId) setUnreadChannelMentionCounts((current) => current[activeTab.channelId!] ? { ...current, [activeTab.channelId!]: 0 } : current);
    tabNodeRefs.current[activeTabId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeTabId, activeTab.kind, activeTab.targetId, activeTab.channelId]);

  useEffect(() => {
    const clearVisibleUnread = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      if (activeTab.kind === 'dm' && activeTab.targetId) setUnreadDmCounts((current) => current[activeTab.targetId!] ? { ...current, [activeTab.targetId!]: 0 } : current);
    if (activeTab.kind === 'dm' && activeTab.targetId) setUnreadDmMentionCounts((current) => current[activeTab.targetId!] ? { ...current, [activeTab.targetId!]: 0 } : current);
      if (activeTab.kind === 'channel' && activeTab.channelId) setUnreadChannelCounts((current) => current[activeTab.channelId!] ? { ...current, [activeTab.channelId!]: 0 } : current);
    if (activeTab.kind === 'channel' && activeTab.channelId) setUnreadChannelMentionCounts((current) => current[activeTab.channelId!] ? { ...current, [activeTab.channelId!]: 0 } : current);
      setTabs((current) => current.map((tab) => tab.id === activeTabId && tab.unread ? { ...tab, unread: 0 } : tab));
    };
    window.addEventListener('focus', clearVisibleUnread);
    document.addEventListener('visibilitychange', clearVisibleUnread);
    return () => {
      window.removeEventListener('focus', clearVisibleUnread);
      document.removeEventListener('visibilitychange', clearVisibleUnread);
    };
  }, [activeTab.kind, activeTab.targetId, activeTab.channelId, activeTabId]);

  useEffect(() => {
    if (!welcomeKind) return;
    const finish = () => setWelcomeKind(null);
    const timeout = window.setTimeout(finish, 3650);
    window.addEventListener('keydown', finish, { once: true });
    window.addEventListener('pointerdown', finish, { once: true });
    welcomeTimerRef.current = timeout;
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('keydown', finish);
      window.removeEventListener('pointerdown', finish);
    };
  }, [welcomeKind]);

  useEffect(() => {
    if (!user || !desktopApi?.onUpdateStatus) return;
    const unsubscribe = desktopApi.onUpdateStatus((payload) => {
      if ((payload.status === 'available' || payload.status === 'downloaded') && payload.version) {
        setNotificationUpdate({ version: payload.version, message: payload.message || 'Доступна новая версия.' });
      }
    });
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [user, desktopApi]);

  useEffect(() => {
    if (!user) return;
    const markActivity = () => {
      lastActivityRef.current = Date.now();
      if (user.status === 'idle' && !wasManuallySetStatusRef.current) void updateStatus('online', user.custom_status || '');
    };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'mousemove'];
    events.forEach((event) => window.addEventListener(event, markActivity, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= 10 * 60 * 1000 && user.status === 'online' && !wasManuallySetStatusRef.current) {
        void updateStatus('idle', user.custom_status || '');
      }
    }, 15000);
    return () => {
      events.forEach((event) => window.removeEventListener(event, markActivity));
      window.clearInterval(timer);
    };
  }, [user]);

  async function updateStatus(next: UserStatus, customStatus = '') {
    try {
      const response = await apiFetch('/api/profile/status', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, customStatus })
      });
      if (!response.ok) throw new Error('Не удалось изменить статус.');
      const payload = await response.json();
      setUser((current) => current ? { ...current, ...payload.user } : current);
      return true;
    } catch (error) { console.error(error); return false; }
  }

  function showWelcome(kind: 'back' | 'new', name: string) {
    setWelcomeName(name);
    setWelcomeKind(kind);
  }

  async function onLoginSuccess(nextUser: User) {
    setUser(nextUser);
    setLoadingError('');
    if (!nextUser.profile_complete) return;
    setLoading(true);
    try {
      const settingsResponse = await apiFetch('/api/settings/me');
      if (settingsResponse.ok) {
        const payload = await settingsResponse.json();
        if (isThemeChoice(payload.settings?.theme)) setTheme(payload.settings.theme);
      }
      await loadWorkspaceData(nextUser);
      showWelcome('back', nextUser.display_name || nextUser.username);
    } catch (error) {
      setLoadingError((error as Error).message || 'Не удалось загрузить рабочее пространство.');
    } finally { setLoading(false); }
  }

  async function onProfileComplete(nextUser: User) {
    setUser(nextUser);
    setLoading(true);
    setLoadingError('');
    try {
      await loadWorkspaceData(nextUser);
      showWelcome('new', nextUser.display_name || nextUser.username);
      openTab(tabHome);
    } catch (error) {
      setLoadingError((error as Error).message || 'Не удалось загрузить рабочее пространство.');
    } finally { setLoading(false); }
  }

  function openTab(next: WorkspaceTab, background = false) {
    setTabs((current) => {
      const existing = current.find((tab) => tab.id === next.id);
      if (existing) return current.map((tab) => tab.id === next.id ? { ...tab, unread: 0, messageId: next.messageId ?? tab.messageId } : tab);
      return [...current, next];
    });
    if (!background) setActiveTabId(next.id);
  }

  function openFriendsTab(background = false) {
    openTab({ id: 'friends', kind: 'friends', title: 'Друзья' }, background);
  }

  function openDmTab(conversation: Conversation, background = false, messageId?: number) {
    if (!background) setUnreadDmCounts((current) => current[conversation.id] ? { ...current, [conversation.id]: 0 } : current);
    const person = conversation.counterpart || conversation.participants.find((participant) => participant.id !== user?.id);
    openTab({
      id: `dm:${conversation.id}`, kind: 'dm', title: person?.display_name || person?.username || conversation.title || 'Диалог',
      targetId: conversation.id, messageId
    }, background);
  }

  function openChannelTab(server: Server, channelId: number, background = false, messageId?: number) {
    if (!background) setUnreadChannelCounts((current) => current[channelId] ? { ...current, [channelId]: 0 } : current);
    const channel = server.channels.find((item) => item.id === channelId);
    if (!channel || channel.type !== 'text') return;
    openTab({
      id: `channel:${channel.id}`, kind: 'channel', title: `# ${channel.name} · ${server.name}`,
      targetId: channel.id, serverId: server.id, channelId: channel.id, messageId
    }, background);
  }

  function openVoiceTab(server: Server, channelId: number): boolean {
    const channel = server.channels.find((item) => item.id === channelId && item.type === 'voice');
    if (!channel) return false;
    if (activeCallInfo) {
      if (!window.confirm('Выйти из личного звонка и подключиться к голосовому каналу?')) return false;
      window.dispatchEvent(new CustomEvent('nexo-end-call'));
      window.setTimeout(() => openTab({ id: `voice:${channel.id}`, kind: 'voice', title: `Голосовой · ${channel.name}`, targetId: channel.id, serverId: server.id, channelId: channel.id }), 180);
      return true;
    }
    if (activeVoiceInfo && activeVoiceInfo.channelId !== channelId) {
      if (!window.confirm('Выйти из текущего голосового канала и подключиться к другому?')) return false;
      window.dispatchEvent(new CustomEvent('nexo-voice-action', { detail: { channelId: activeVoiceInfo.channelId, action: 'leave' } }));
      window.setTimeout(() => openTab({ id: `voice:${channel.id}`, kind: 'voice', title: `Голосовой · ${channel.name}`, targetId: channel.id, serverId: server.id, channelId: channel.id }), 140);
      return true;
    }
    openTab({ id: `voice:${channel.id}`, kind: 'voice', title: `Голосовой · ${channel.name}`, targetId: channel.id, serverId: server.id, channelId: channel.id });
    return true;
  }

  function selectServer(server: Server) {
    setExpandedServers((current) => current.includes(server.id) ? current : [...current, server.id]);
    const firstTextChannel = server.channels.find((channel) => channel.type === 'text');
    if (firstTextChannel) openChannelTab(server, firstTextChannel.id);
    else setCreateChannelServerId(server.id);
  }

  function openSettingsTab(section: WorkspaceTab['initialSection'] = 'account', background = false) {
    openTab({ id: 'settings', kind: 'settings', title: 'Настройки', initialSection: section }, background);
  }

  function closeTab(tabId: string) {
    if (tabId === 'home') return;
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;
    setClosedTabs((current) => [tab, ...current].slice(0, 12));
    const currentIndex = tabs.findIndex((item) => item.id === tabId);
    const next = tabs.filter((item) => item.id !== tabId);
    setTabs(next);
    if (activeTabId === tabId) setActiveTabId(next[Math.max(0, currentIndex - 1)]?.id || 'home');
  }

  function reorderTabs(draggedId: string, targetId: string) {
    if (draggedId === targetId || draggedId === 'home') return;
    setTabs((current) => {
      const from = current.findIndex((tab) => tab.id === draggedId);
      const to = current.findIndex((tab) => tab.id === targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return [next[0]?.id === 'home' ? next[0] : tabHome, ...next.filter((tab) => tab.id !== 'home')];
    });
  }

  function pinTab(tabId: string) {
    if (tabId === 'home') return;
    setTabs((current) => {
      const next = current.map((tab) => tab.id === tabId ? { ...tab, pinned: !tab.pinned } : tab);
      const home = next.find((tab) => tab.kind === 'home') || tabHome;
      return [home, ...next.filter((tab) => tab.id !== 'home').sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))];
    });
  }

  function restoreClosedTab() {
    const last = closedTabs[0];
    if (!last) return;
    setClosedTabs((current) => current.slice(1));
    openTab(last);
  }

  function closeContextualTabs(action: 'others' | 'right') {
    if (!contextMenu?.tabId) return;
    const index = tabs.findIndex((tab) => tab.id === contextMenu.tabId);
    const keep = tabs.filter((tab, tabIndex) => tab.id === 'home' || tab.pinned || (action === 'others' ? tab.id === contextMenu.tabId : tabIndex <= index));
    setTabs(keep);
    if (!keep.some((tab) => tab.id === activeTabId)) setActiveTabId(contextMenu.tabId);
    setContextMenu(null);
  }

  function openSidebarTarget(target: SidebarPin, background = false) {
    if (target.kind === 'dm') {
      const conversation = conversations.find((item) => item.id === target.targetId);
      if (conversation) openDmTab(conversation, background);
    } else {
      const server = servers.find((item) => item.id === target.serverId);
      if (server && target.channelId) openChannelTab(server, target.channelId, background);
    }
  }

  function setPinned(target: SidebarPin) {
    setPinnedItems((current) => {
      const exists = current.some((item) => item.id === target.id);
      return exists ? current.filter((item) => item.id !== target.id) : [...current, target];
    });
    setContextMenu(null);
  }

  function openPalette(mode: 'all' | 'new-message' = 'all') {
    setPaletteMode(mode);
    setPaletteQuery('');
    setPaletteActiveIndex(0);
    setPaletteOpen(true);
  }

  async function createSpace() {
    if (createSpaceName.trim().length < 3) {
      setCreateSpaceStatus('Название должно содержать минимум 3 символа.');
      return;
    }
    setCreateSpaceStatus('Создаём пространство…');
    try {
      const response = await apiFetch('/api/servers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: createSpaceName.trim(), description: createSpaceDescription.trim() })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось создать пространство.');
      const nextServer = payload.server as Server;
      setServers((current) => [nextServer, ...current]);
      setExpandedServers((current) => [...current, nextServer.id]);
      setCreateSpaceOpen(false);
      setCreateSpaceName('');
      setCreateSpaceDescription('');
      setCreateSpaceStatus('');
      const firstChannel = nextServer.channels.find((channel) => channel.type === 'text');
      if (firstChannel) openChannelTab(nextServer, firstChannel.id);
    } catch (error) { setCreateSpaceStatus((error as Error).message); }
  }

  function openCreateChannel(server: Server) {
    setContextMenu(null);
    setCreateChannelServerId(server.id);
    setCreateChannelName('');
    setCreateChannelTopic('');
    setCreateChannelType('text');
    setCreateChannelUserLimit(8);
    setCreateChannelStatus('');
  }

  async function createChannel() {
    if (!createChannelServerId) return;
    if (createChannelName.trim().length < 3 || createChannelName.trim().length > 32) {
      setCreateChannelStatus('Имя канала должно содержать от 3 до 32 символов.');
      return;
    }
    setCreateChannelStatus('Создаём канал…');
    try {
      const response = await apiFetch(`/api/servers/${createChannelServerId}/channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: createChannelName.trim(), topic: createChannelTopic.trim(), type: createChannelType, userLimit: createChannelUserLimit })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось создать канал.');
      const nextServer = payload.server as Server;
      setServers((current) => current.map((server) => server.id === nextServer.id ? nextServer : server));
      setExpandedServers((current) => current.includes(nextServer.id) ? current : [...current, nextServer.id]);
      const createdChannel = nextServer.channels.find((channel) => !servers.find((server) => server.id === nextServer.id)?.channels.some((old) => old.id === channel.id));
      setCreateChannelServerId(null);
      if (createdChannel?.type === 'text') openChannelTab(nextServer, createdChannel.id);
      if (createdChannel?.type === 'voice') openVoiceTab(nextServer, createdChannel.id);
    } catch (error) {
      setCreateChannelStatus((error as Error).message);
    }
  }

  async function leaveServer(server: Server) {
    setContextMenu(null);
    try {
      const response = await apiFetch(`/api/servers/${server.id}/leave`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось покинуть пространство.');
      const currentTab = tabs.find((tab) => tab.id === activeTabId);
      setServers((current) => current.filter((item) => item.id !== server.id));
      setTabs((current) => current.filter((tab) => tab.serverId !== server.id));
      setPinnedItems((current) => current.filter((item) => item.serverId !== server.id));
      if (currentTab?.serverId === server.id) setActiveTabId('home');
    } catch (error) {
      window.alert((error as Error).message);
    }
  }

  function openChannelSettings(target: SidebarPin) {
    const channel = servers.find((server) => server.id === target.serverId)?.channels.find((item) => item.id === target.channelId);
    if (!channel) return;
    setChannelEditTarget(target);
    setChannelEditName(channel.name);
    setChannelEditTopic(channel.topic || '');
    setChannelEditStatus('');
    setChannelDeleteConfirm(false);
    setContextMenu(null);
  }

  async function saveChannelSettings() {
    if (!channelEditTarget?.serverId || !channelEditTarget.channelId) return;
    setChannelEditStatus('Сохраняем…');
    try {
      const response = await apiFetch(`/api/servers/${channelEditTarget.serverId}/channels/${channelEditTarget.channelId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: channelEditName.trim(), topic: channelEditTopic.trim() })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось сохранить канал.');
      const channel = payload.channel;
      setServers((current) => current.map((server) => server.id === channelEditTarget.serverId
        ? { ...server, channels: server.channels.map((item) => item.id === channel.id ? { ...item, ...channel } : item) }
        : server));
      setTabs((current) => current.map((tab) => tab.kind === 'channel' && tab.channelId === channel.id
        ? { ...tab, title: `# ${channel.name} · ${servers.find((server) => server.id === channelEditTarget.serverId)?.name || ''}` }
        : tab));
      setChannelEditTarget(null);
    } catch (error) {
      setChannelEditStatus((error as Error).message);
    }
  }

  async function deleteChannel() {
    if (!channelEditTarget?.serverId || !channelEditTarget.channelId) return;
    setChannelEditStatus('Удаляем канал…');
    try {
      const response = await apiFetch(`/api/servers/${channelEditTarget.serverId}/channels/${channelEditTarget.channelId}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Не удалось удалить канал.');
      const serverId = channelEditTarget.serverId;
      const channelId = channelEditTarget.channelId;
      setServers((current) => current.map((server) => server.id === serverId
        ? { ...server, channels: server.channels.filter((channel) => channel.id !== channelId) }
        : server));
      setTabs((current) => current.filter((tab) => tab.channelId !== channelId));
      setPinnedItems((current) => current.filter((item) => item.channelId !== channelId));
      if (activeTabId === `channel:${channelId}`) setActiveTabId('home');
      setChannelEditTarget(null);
      setChannelDeleteConfirm(false);
    } catch (error) {
      setChannelEditStatus((error as Error).message);
      setChannelDeleteConfirm(false);
    }
  }

  const paletteEntries = useMemo<PaletteEntry[]>(() => {
    const items: PaletteEntry[] = paletteMode === 'all' ? [
      { id: 'go-home', title: 'Открыть главную', group: 'Действия', icon: <Home size={16} />, run: () => { setActiveTabId('home'); } },
      { id: 'friends', title: 'Открыть друзей', group: 'Действия', icon: <Users size={16} />, run: () => openFriendsTab() },
      { id: 'new-friend', title: 'Добавить друга', subtitle: 'По логину @handle', group: 'Действия', icon: <UserRoundPlus size={16} />, run: () => openFriendsTab() },
      { id: 'space', title: 'Создать пространство', group: 'Действия', icon: <FolderPlus size={16} />, run: () => setCreateSpaceOpen(true) },
      { id: 'settings', title: 'Открыть настройки', group: 'Действия', icon: <Settings size={16} />, run: () => openSettingsTab() },
      { id: 'theme-light', title: 'Сменить тему: светлая', group: 'Действия', icon: <Sun size={16} />, run: () => setTheme('light') },
      { id: 'theme-dark', title: 'Сменить тему: тёмная', group: 'Действия', icon: <Moon size={16} />, run: () => setTheme('dark') },
      { id: 'theme-system', title: 'Сменить тему: системная', group: 'Действия', icon: <Monitor size={16} />, run: () => setTheme('system') },
      { id: 'logout', title: 'Выйти из аккаунта', group: 'Действия', icon: <LogOut size={16} />, run: () => void handleLogout() }
    ] : [];
    if (paletteMode === 'all') {
      conversations.forEach((conversation) => {
        const person = conversation.counterpart || conversation.participants.find((participant) => participant.id !== user?.id);
        items.push({ id: `dm-${conversation.id}`, title: person?.display_name || conversation.title || 'Диалог', subtitle: person?.username ? `@${person.username}` : 'Личный диалог', group: 'Диалоги', icon: <MessageCircle size={16} />, run: () => openDmTab(conversation) });
      });
      friends.friends.forEach((friend) => {
        items.push({ id: `friend-${friend.id}`, title: friend.user.display_name || friend.user.username, subtitle: `@${friend.user.username}`, group: 'Друзья', icon: <Users size={16} />, run: () => void handleOpenFriend(friend.user.username) });
      });
      servers.forEach((server) => server.channels.filter((channel) => channel.type === 'text').forEach((channel) => {
        items.push({ id: `channel-${channel.id}`, title: `# ${channel.name}`, subtitle: server.name, group: 'Каналы', icon: <HashIcon />, run: () => openChannelTab(server, channel.id) });
      }));
    } else {
      friends.friends.forEach((friend) => {
        items.push({ id: `new-dm-${friend.id}`, title: friend.user.display_name || friend.user.username, subtitle: `@${friend.user.username}`, group: 'Друзья', icon: <MessageCircle size={16} />, run: () => void handleOpenFriend(friend.user.username) });
      });
    }
    const groupOrder = ['Диалоги', 'Друзья', 'Каналы', 'Действия'];
    return items.sort((left, right) => groupOrder.indexOf(left.group) - groupOrder.indexOf(right.group));
  }, [paletteMode, conversations, friends, servers, user, theme]);

  const filteredPalette = paletteEntries.filter((item) => fuzzyMatch(`${item.title} ${item.subtitle || ''}`, paletteQuery));
  const paletteGroups = ['Диалоги', 'Друзья', 'Каналы', 'Действия'];

  async function handleOpenFriend(username: string) {
    try {
      const existing = conversations.find((conversation) => conversation.counterpart?.username === username
        || conversation.participants.some((participant) => participant.id !== user?.id && participant.username === username));
      if (existing) return openDmTab(existing);
      const response = await apiFetch('/api/conversations/dm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Не удалось открыть диалог.');
      const conversation = payload.conversation as Conversation;
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
      openDmTab(conversation);
    } catch (error) { console.error(error); }
  }

  async function handleLogout() {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); }
    finally {
      setWorkspaceRestored(false);
      setConversations([]); setFriends({ incoming: [], outgoing: [], friends: [] }); setServers([]); setPinnedItems([]);
      localStorage.removeItem(tabStorageKey(user?.id || 0));
      setUser(null);
      setTabs([tabHome]);
      setActiveTabId('home');
      setWelcomeKind(null);
    }
  }

  async function handleCheckUpdates() {
    if (!desktopApi?.checkForUpdates) return { status: 'unavailable', message: 'Проверка доступна в настольной версии Nexo.' };
    return desktopApi.checkForUpdates();
  }

  function handlePaletteKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setPaletteActiveIndex((current) => Math.min(filteredPalette.length - 1, current + 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setPaletteActiveIndex((current) => Math.max(0, current - 1)); }
    if (event.key === 'Enter') { event.preventDefault(); filteredPalette[paletteActiveIndex]?.run(); setPaletteOpen(false); }
    if (event.key === 'Escape') { event.preventDefault(); setPaletteOpen(false); }
  }

  useEffect(() => {
    if (!paletteOpen) return;
    const hotkeyInput = document.querySelector<HTMLInputElement>('.command-palette-input');
    hotkeyInput?.focus();
  }, [paletteOpen]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'k') { event.preventDefault(); openPalette(); }
        else if (event.key.toLowerCase() === 'b') { event.preventDefault(); setSidebarCollapsed((value) => !value); }
        else if (event.shiftKey && event.key.toLowerCase() === 't') { event.preventDefault(); restoreClosedTab(); }
        else if (event.key.toLowerCase() === 't') { event.preventDefault(); openPalette(); }
        else if (event.key.toLowerCase() === 'w') { event.preventDefault(); closeTab(activeTabId); }
        else if (event.key === 'Tab') {
          event.preventDefault();
          const current = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId));
          const direction = event.shiftKey ? -1 : 1;
          setActiveTabId(tabs[(current + direction + tabs.length) % tabs.length].id);
        } else if (event.key.toLowerCase() === '9') {
          event.preventDefault(); setActiveTabId(tabs[tabs.length - 1]?.id || 'home');
        } else if (/^[1-8]$/.test(event.key)) {
          event.preventDefault();
          setActiveTabId(tabs[Number(event.key) - 1]?.id || 'home');
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tabs, activeTabId, closedTabs]);

  function beginResize(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeRef.current = { startX: event.clientX, width: sidebarWidth, initialWidth: sidebarWidth };
    const onMove = (move: globalThis.MouseEvent) => {
      if (!resizeRef.current) return;
      const nextWidth = Math.max(220, Math.min(360, resizeRef.current.initialWidth + move.clientX - resizeRef.current.startX));
      resizeRef.current.width = nextWidth;
      setSidebarWidth(nextWidth);
    };
    const onUp = () => {
      if (user && resizeRef.current) localStorage.setItem(sidebarStorageKey(user.id), String(Math.round(resizeRef.current.width)));
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }


  function setMic(next: boolean) {
    if (micMuted !== next) playNexoSound(next ? 'mic-off' : 'mic-on');
    setMicMuted(next);
    if (user) localStorage.setItem(`nexo.mic-muted.${user.id}`, String(next));
  }

  async function changeStatus(next: UserStatus) {
    wasManuallySetStatusRef.current = next !== 'online';
    await updateStatus(next, user?.custom_status || '');
  }

  function contextTargetClick(event: MouseEvent, target: SidebarPin) {
    if (event.type === 'contextmenu') {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, target });
    }
  }

  if (loading) {
    return (
      <div className="app-loading-screen">
        <motion.div className="nexo-loading-logo" initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }}>
          <span className="brand-mark">N</span>
        </motion.div>
        <p className="loading-brand">Nexo</p>
        <span className="loading-caption">YOUR SPACE TO CONNECT</span>
        <AnimatePresence mode="wait"><motion.p key={loadingPhraseIndex} className="loading-phrase"
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
          transition={{ duration: .25 }}>{loadingPhrases[loadingPhraseIndex]}</motion.p></AnimatePresence>
        <div className="loading-track"><motion.span animate={{ scaleX: [.12, .72, .35, .94] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }} /></div>
        <span className="loading-footnote">NEXO DESKTOP · ALPHA</span>
      </div>
    );
  }

  if (loadingError) {
    return (
      <div className="boot-error-screen">
        <div className="boot-error-mark">N</div>
        <h1>Не удаётся связаться с сервером Nexo</h1>
        <p>{loadingError}</p>
        <div><button className="primary" onClick={() => setBootAttempt((value) => value + 1)}>Повторить</button>
          <button className="ghost" onClick={() => desktopApi?.openLogs?.()}>Открыть журнал</button></div>
      </div>
    );
  }

  const stage = user ? (user.profile_complete ? 'workspace' : 'profile') : 'login';

  return (
    <div className="app-root nexo-root">
      <header className="app-nav nexo-titlebar">
        <div className="titlebar-brand"><img className="brand-image" src="/nexo-mark.svg" alt="" /><strong>Nexo</strong><span className="titlebar-version">ALPHA</span></div>
        <button type="button" className="titlebar-command" onClick={() => openPalette()} title="Найти или выполнить команду (Ctrl+K)">
          <Search size={15} /><span>Найти или выполнить команду</span><kbd>Ctrl K</kbd>
        </button>
        <div className="titlebar-actions"><span className="titlebar-current">{currentTitle}</span></div>
      </header>

      {stage === 'login' && <main className="app-stage"><LoginPanel onSuccess={onLoginSuccess} /></main>}
      {stage === 'profile' && user && <main className="app-stage"><ProfileSetup user={user} onComplete={onProfileComplete} /></main>}

      {stage === 'workspace' && user && (
        <>
          <div className="nexo-tabbar">
            <button type="button" className="sidebar-toggle-button"
              aria-label={sidebarCollapsed ? 'Показать боковую панель' : 'Скрыть боковую панель'} data-tooltip={sidebarCollapsed ? 'Показать боковую панель (Ctrl+B)' : 'Скрыть боковую панель (Ctrl+B)'}
              onClick={() => setSidebarCollapsed((value) => !value)}>
              {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
            <div className="tab-scroll-arrow"><button aria-label="Прокрутить вкладки влево" onClick={() => tabStripRef.current?.scrollBy({ left: -240, behavior: 'smooth' })}><ChevronLeft size={15} /></button></div>
            <div className="nexo-tabs" ref={tabStripRef}>
              <AnimatePresence initial={false}>
              {tabs.map((tab) => (
                <motion.button key={tab.id} initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: tab.pinned ? 42 : 'auto' }} exit={{ opacity: 0, width: 0 }} transition={{ duration: .18 }} layoutId={tab.pinned ? undefined : `tab-${tab.id}`}
                  ref={(node) => { tabNodeRefs.current[tab.id] = node; }}
                  type="button" draggable={tab.kind !== 'home'}
                  className={`nexo-tab ${activeTabId === tab.id ? 'active' : ''} ${tab.pinned ? 'pinned' : ''}`}
                  title={tab.title} aria-selected={activeTabId === tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); closeTab(tab.id); } }}
                  onDragStartCapture={(event: DragEvent<HTMLButtonElement>) => { event.dataTransfer.setData('text/nexo-tab', tab.id); event.dataTransfer.effectAllowed = 'move'; }}
                  onDragOverCapture={(event: DragEvent<HTMLButtonElement>) => event.preventDefault()}
                  onDropCapture={(event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); reorderTabs(event.dataTransfer.getData('text/nexo-tab'), tab.id); }}
                  onContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, tabId: tab.id }); }}>
                  {tab.kind === 'home' ? <Home size={14} /> : tab.kind === 'friends' ? <Users size={14} /> : tab.kind === 'dm' ? <Avatar user={conversations.find((conversation) => conversation.id === tab.targetId)?.counterpart || conversations.find((conversation) => conversation.id === tab.targetId)?.participants.find((participant) => participant.id !== user?.id)} size={19} /> : tab.kind === 'channel' ? <HashIcon /> : tab.kind === 'voice' ? <Volume2 size={14} /> : <Settings size={14} />}
                  {!tab.pinned && <span className="tab-title">{tab.title}</span>}
                  {tab.unread ? <span className="tab-unread">{tab.unread > 9 ? '9+' : tab.unread}</span> : null}
                  {tab.pinned ? null : <span className="tab-close" role="button" data-tooltip="Закрыть вкладку (Ctrl+W)"
                    onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}><X size={12} /></span>}
                  {activeTabId === tab.id && <motion.i layoutId="active-tab-indicator" className="tab-indicator" />}
                </motion.button>
              ))}
              </AnimatePresence>
            </div>
            <button type="button" className="tab-add" aria-label="Новая вкладка" data-tooltip="Новая вкладка (Ctrl+T)" onClick={() => openPalette()}>
              <Plus size={16} />
            </button>
            <div className="tab-scroll-arrow"><button aria-label="Прокрутить вкладки вправо" onClick={() => tabStripRef.current?.scrollBy({ left: 240, behavior: 'smooth' })}><ChevronRightIcon size={15} /></button></div>
          </div>

          <div className={`nexo-workbench ${activeTab.kind === 'settings' ? 'settings-active' : ''}`}>
            <aside className={`nexo-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}>
              {!sidebarCollapsed && (
                <>
                  <div className="sidebar-quick">
                    <button type="button" className={activeTab.kind === 'home' ? 'active' : ''} onClick={() => setActiveTabId('home')}><Home size={17} />Главная</button>
                    <button type="button" className={activeTab.kind === 'friends' ? 'active' : ''} onClick={() => openFriendsTab()}>
                      <Users size={17} />Друзья{unreadRequests > 0 && <span className="sidebar-badge">{unreadRequests > 99 ? '99+' : unreadRequests}</span>}
                    </button>
                  </div>

                  <div className="sidebar-scroll-area">
                  <SidebarSection title="Закреплённое" count={pinnedItems.length} collapsed={collapsedSections.includes('pinned')}
                    onToggle={() => setCollapsedSections((current) => current.includes('pinned') ? current.filter((item) => item !== 'pinned') : [...current, 'pinned'])}>
                    {pinnedItems.map((item) => <SidebarTarget key={item.id} item={item} onClick={() => openSidebarTarget(item)}
                      onContextMenu={(event) => contextTargetClick(event, item)} />)}
                    {pinnedItems.length === 0 && <small className="sidebar-empty">Закрепляйте диалоги и каналы через правую кнопку.</small>}
                  </SidebarSection>

                  <SidebarSection title="Диалоги" count={conversations.length} collapsed={collapsedSections.includes('dms')}
                    onToggle={() => setCollapsedSections((current) => current.includes('dms') ? current.filter((item) => item !== 'dms') : [...current, 'dms'])}
                    action={<button type="button" aria-label="Новое сообщение" data-tooltip="Новое сообщение" onClick={() => openPalette('new-message')}><Plus size={14} /></button>}>
                    {conversations.map((conversation) => {
                      const person = conversation.counterpart || conversation.participants.find((participant) => participant.id !== user.id);
                      const item: SidebarPin = { id: `dm:${conversation.id}`, kind: 'dm', title: person?.display_name || person?.username || 'Диалог', targetId: conversation.id };
                      return <button type="button" key={conversation.id} className={`sidebar-row ${activeTabId === item.id ? 'active' : ''} ${unreadDmCounts[conversation.id] ? 'has-unread' : ''} ${unreadDmMentionCounts[conversation.id] ? 'has-mention' : ''}`}
                        onClick={(event) => openDmTab(conversation, event.ctrlKey || event.metaKey)}
                        onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); openDmTab(conversation, true); } }}
                        onContextMenu={(event) => contextTargetClick(event, item)}>
                        <Avatar user={person} size={27} showStatus />
                        <span className="sidebar-row-text"><strong>{person?.display_name || person?.username || 'Диалог'}</strong><small>Откройте, чтобы продолжить разговор</small></span>
                        {unreadDmCounts[conversation.id] > 0 && <span className="sidebar-count-badge" data-tooltip={`${unreadDmCounts[conversation.id]} новых сообщений`}>{unreadDmCounts[conversation.id] > 99 ? '99+' : unreadDmCounts[conversation.id]}</span>}
                        {unreadDmMentionCounts[conversation.id] > 0 && <span className="sidebar-mention-badge" data-tooltip={`${unreadDmMentionCounts[conversation.id]} упоминаний`}>@{unreadDmMentionCounts[conversation.id] > 99 ? '99+' : unreadDmMentionCounts[conversation.id]}</span>}
                      </button>;
                    })}
                    {conversations.length === 0 && <button type="button" className="sidebar-empty-action" onClick={() => openFriendsTab()}>Диалогов пока нет — найдите друга</button>}
                  </SidebarSection>

                  <SidebarSection title="Пространства" count={servers.length} collapsed={collapsedSections.includes('servers')}
                    onToggle={() => setCollapsedSections((current) => current.includes('servers') ? current.filter((item) => item !== 'servers') : [...current, 'servers'])}
                    action={<button type="button" aria-label="Создать пространство" data-tooltip="Создать пространство" onClick={() => setCreateSpaceOpen(true)}><Plus size={14} /></button>}>
                    {servers.map((server) => (
                      <div className="sidebar-server" key={server.id}>
                        <button type="button" className="sidebar-server-head" onClick={() => setExpandedServers((current) => current.includes(server.id) ? current.filter((id) => id !== server.id) : [...current, server.id])}
                          onContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, server }); }}>
                          {expandedServers.includes(server.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span className="server-tree-icon">{server.icon && (server.icon.startsWith('http') || server.icon.startsWith('data:image/'))
                            ? <img src={server.icon} alt="" /> : server.icon || <DefaultAvatar preset={(server.id * 7 + 3) % 12} size={26} />}</span>
                          <strong>{server.name}</strong>
                        </button>
                        {expandedServers.includes(server.id) && server.channels.map((channel) => {
                          const item: SidebarPin = { id: `channel:${channel.id}`, kind: 'channel', title: `# ${channel.name} · ${server.name}`, targetId: channel.id, serverId: server.id, channelId: channel.id };
                          if (channel.type === 'voice') {
                            const members = voiceParticipantsByChannel[channel.id] || [];
                            const currentVoiceTab = activeTabId === `voice:${channel.id}`;
                            const canConnect = channel.canConnect !== false;
                            return <div key={channel.id} className={`sidebar-voice-channel ${canConnect ? '' : 'locked'}`}>
                              <button type="button" disabled={!canConnect} className={`sidebar-row voice-channel-row ${currentVoiceTab ? 'active' : ''}`}
                                onClick={() => openVoiceTab(server, channel.id)} data-tooltip={canConnect ? `Войти в голосовой канал ${channel.name}` : 'Нет права подключаться к этому каналу'}>
                                {canConnect ? <Volume2 size={14} /> : <Lock size={14} />}
                                <span className="sidebar-row-text"><strong>{channel.name}</strong></span>
                                <small>{canConnect ? `${members.length}/${channel.user_limit || 8}` : 'Нет доступа'}</small>
                              </button>
                              {members.map((member) => <div key={member.user.id} className={voiceSpeakingByChannel[channel.id]?.includes(member.user.id) ? "sidebar-voice-member speaking" : "sidebar-voice-member"}>
                                <Avatar user={member.user} size={24} />
                                <span>{member.user.display_name || member.user.username}</span>
                                {member.muted && <MicOff size={12} />}
                                {member.deafened && <HeadphoneOff size={12} />}
                              </div>)}
                            </div>;
                          }

                          return <button type="button" key={channel.id} className={`sidebar-row channel-row ${activeTabId === item.id ? 'active' : ''} ${unreadChannelCounts[channel.id] ? 'has-unread' : ''} ${unreadChannelMentionCounts[channel.id] ? 'has-mention' : ''}`}
                            onClick={(event) => openChannelTab(server, channel.id, event.ctrlKey || event.metaKey)}
                            onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); openChannelTab(server, channel.id, true); } }}
                            onContextMenu={(event) => contextTargetClick(event, item)}>
                            <HashIcon /><span className="sidebar-row-text"><strong>{channel.name}</strong></span>
                            {unreadChannelCounts[channel.id] > 0 && <span className="sidebar-count-badge" data-tooltip={`${unreadChannelCounts[channel.id]} новых сообщений`}>{unreadChannelCounts[channel.id] > 99 ? '99+' : unreadChannelCounts[channel.id]}</span>}
                            {unreadChannelMentionCounts[channel.id] > 0 && <span className="sidebar-mention-badge" data-tooltip={`${unreadChannelMentionCounts[channel.id]} упоминаний`}>@{unreadChannelMentionCounts[channel.id] > 99 ? '99+' : unreadChannelMentionCounts[channel.id]}</span>}
                          </button>;
                        })}
                      </div>
                    ))}
                    {servers.length === 0 && <small className="sidebar-empty">Ваши командные пространства появятся здесь.</small>}
                  </SidebarSection>
                  </div>
                  <div className="sidebar-user-area">
                    {activeVoiceInfo && <div className="active-voice-panel">
                      <div className="active-voice-heading">
                        <button type="button" className="active-voice-return" onClick={() => setActiveTabId(`voice:${activeVoiceInfo.channelId}`)}>
                          <span className="active-voice-dot" />
                          <span><strong>Голосовая связь</strong><small>{activeVoiceInfo.channelName} · {activeVoiceInfo.serverName} · {formatCallDuration(voiceClock - activeVoiceInfo.joinedAt)}</small></span>
                        </button>
                        <button type="button" className="hangup" aria-label="Выйти из голосового канала" data-tooltip="Выйти из голосового канала" onClick={() => window.dispatchEvent(new CustomEvent('nexo-voice-action', { detail: { channelId: activeVoiceInfo.channelId, action: 'leave' } }))}><PhoneOff size={15} /></button>
                      </div>
                      <div className="active-voice-actions">
                        <button type="button" className={micMuted ? 'is-off' : ''} data-tooltip={micMuted ? 'Включить микрофон' : 'Выключить микрофон'} onClick={() => { if (deafened) setSavedMicMuted(!savedMicMuted); else setMic(!micMuted); }}>{micMuted ? <MicOff size={15} /> : <Mic size={15} />}</button>
                        <button type="button" className={deafened ? 'is-off' : ''} data-tooltip={deafened ? 'Включить звук' : 'Выключить звук'} onClick={() => { if (!deafened) { setSavedMicMuted(micMuted); setMic(true); setDeafened(true); } else { setDeafened(false); setMic(savedMicMuted); } }}>{deafened ? <HeadphoneOff size={15} /> : <Headphones size={15} />}</button>
                        <button type="button" data-tooltip="Камера" onClick={() => window.dispatchEvent(new CustomEvent('nexo-voice-action', { detail: { channelId: activeVoiceInfo.channelId, action: 'camera' } }))}><Camera size={15} /></button>
                        <button type="button" data-tooltip="Демонстрация экрана" onClick={() => window.dispatchEvent(new CustomEvent('nexo-voice-action', { detail: { channelId: activeVoiceInfo.channelId, action: 'screen' } }))}><MonitorUp size={15} /></button>
                      </div>
                    </div>}
                    {activeCallInfo && <div className="active-call-strip">
                      <button type="button" className="active-call-return" onClick={() => setActiveTabId(`dm:${activeCallInfo.conversationId}`)} aria-label="Вернуться к звонку">
                        <span className="status-dot" />
                        <span className="active-call-copy">
                          <strong>Звонок · {activeTab.kind === 'dm' && activeTab.targetId === activeCallInfo.conversationId ? activeTab.title : activeCallInfo.title}</strong>
                          <small>{formatCallDuration(callClock - activeCallInfo.startedAt)} · Личный диалог</small>
                        </span>
                      </button>
                      <button type="button" className="hangup" data-tooltip="Завершить звонок" aria-label="Завершить звонок" onClick={() => window.dispatchEvent(new CustomEvent('nexo-end-call'))}><PhoneOff size={15} /></button>
                    </div>}
                    
                    <div className="nexo-user-dock">
                      <div className="dock-user" aria-label={`${user.display_name || user.username}, @${user.username}`}>
                        <Avatar user={user} size={36} showStatus />
                        <span className="dock-user-copy"><strong>{user.display_name || user.username}</strong><small>{user.custom_status || `@${user.username}`}</small></span>
                      </div>
                      <div className="dock-actions">
                        <button type="button" className={micMuted ? 'dock-icon danger' : 'dock-icon'}
                          aria-label={micMuted ? 'Включить микрофон' : 'Выключить микрофон'}
                          data-tooltip={micMuted ? 'Включить микрофон' : 'Выключить микрофон'} onClick={() => setMic(!micMuted)}>
                          {micMuted ? <MicOff size={17} /> : <Mic size={17} />}
                        </button>
                        <button type="button" className={deafened ? 'dock-icon danger' : 'dock-icon'}
                          aria-label={deafened ? 'Включить звук' : 'Отключить звук'}
                          data-tooltip={deafened ? 'Включить звук' : 'Отключить звук'} onClick={() => {
                            if (!deafened) { playNexoSound('headphones-off'); setSavedMicMuted(micMuted); setMic(true); setDeafened(true); }
                            else { playNexoSound('headphones-on'); setDeafened(false); setMic(savedMicMuted); }
                          }}>
                          {deafened ? <HeadphoneOff size={17} /> : <Headphones size={17} />}
                        </button>
                        <button type="button" className="dock-icon" aria-label="Настройки" data-tooltip="Настройки"
                          onClick={() => openSettingsTab('account')}><Settings size={17} /></button>
                      </div>
                    </div>                  </div>
                </>
              )}
              <div className="sidebar-resizer" onMouseDown={beginResize} onDoubleClick={() => { setSidebarWidth(264); if (user) localStorage.setItem(sidebarStorageKey(user.id), '264'); }} title="Перетащите, чтобы изменить ширину" />
            </aside>

            <main className="nexo-tab-content">
              {tabs.map((tab) => (
                <section key={tab.id} className="nexo-tab-panel" hidden={activeTabId !== tab.id}>
                  {tab.kind === 'home' && <HomeView user={user} conversations={conversations} servers={servers}
                    unreadDmCounts={unreadDmCounts} unreadChannelCounts={unreadChannelCounts}
                    openFriends={openFriendsTab} openPalette={openPalette} openDm={openDmTab}
                    openChannel={(server, channelId) => openChannelTab(server, channelId)} />}
                  {tab.kind === 'friends' && <FriendsPanel user={user} onOpenConversation={(friend) => void handleOpenFriend(friend.username)} />}
                  {tab.kind === 'dm' && <MessengerWorkspace key={tab.id} user={user} initialMode="friends" embedded isActive={tab.id === activeTabId}
                    showConversationList={false} openConversationId={tab.targetId || null} openMessageId={tab.messageId || null}
                    pendingIncomingCall={pendingIncomingCall?.conversationId === tab.targetId ? pendingIncomingCall : null}
                    onIncomingCallHandled={() => setPendingIncomingCall(null)}
                    micMuted={micMuted} onToggleMic={() => setMic(!micMuted)} deafened={deafened} audioInputId={audioInputId} audioOutputId={audioOutputId} videoInputId={videoInputId} />}
                  {tab.kind === 'voice' && (() => {
                    const server = servers.find((item) => item.id === tab.serverId);
                    const channel = server?.channels.find((item) => item.id === tab.channelId && item.type === 'voice');
                    return server && channel ? <VoiceRoom key={tab.id} server={server} channel={channel} user={user}
                      micMuted={micMuted} deafened={deafened} audioInputId={audioInputId} audioOutputId={audioOutputId} videoInputId={videoInputId}
                      onToggleMic={() => setMic(!micMuted)}
                      onToggleDeafen={() => {
                        if (!deafened) { setSavedMicMuted(micMuted); setMic(true); setDeafened(true); }
                        else { setDeafened(false); setMic(savedMicMuted); }
                      }}
                      onLeave={() => closeTab(tab.id)} /> : <div className="empty-state"><p>Голосовой канал больше недоступен.</p></div>;
                  })()}
                  {tab.kind === 'channel' && <MessengerWorkspace key={tab.id} user={user} initialMode="servers" embedded isActive={tab.id === activeTabId}
                    showChannelSidebar={false} openServerId={tab.serverId || null} openChannelId={tab.channelId || null} openMessageId={tab.messageId || null}
                    onEditChannel={() => {
                      const server = servers.find((item) => item.id === tab.serverId);
                      if (server && tab.channelId) openChannelSettings({
                        id: `channel:${tab.channelId}`, kind: 'channel',
                        title: tab.title, targetId: tab.channelId, serverId: server.id, channelId: tab.channelId
                      });
                    }}
                    micMuted={micMuted} onToggleMic={() => setMic(!micMuted)} deafened={deafened} audioInputId={audioInputId} audioOutputId={audioOutputId} videoInputId={videoInputId} />}
                  {tab.kind === 'settings' && <SettingsPanel key={tab.id} user={user} onUserUpdate={(nextUser) => setUser(nextUser)}
                    initialSection={tab.initialSection || 'account'} appVersion={appVersion} onCheckUpdates={handleCheckUpdates}
                    audioInputId={audioInputId} audioOutputId={audioOutputId} videoInputId={videoInputId}
                    onVideoInputChange={(id) => { setVideoInputId(id); localStorage.setItem(`nexo.video-input.${user.id}`, id); }}
                    onAudioInputChange={(id) => { setAudioInputId(id); localStorage.setItem(`nexo.audio-input.${user.id}`, id); }}
                    onAudioOutputChange={(id) => { setAudioOutputId(id); localStorage.setItem(`nexo.audio-output.${user.id}`, id); }}
                    onClose={() => closeTab(tab.id)} onLogout={handleLogout} />}
                </section>
              ))}
            </main>
          </div>

        </>
      )}

      {paletteOpen && <CommandPalette entries={paletteEntries} query={paletteQuery} activeIndex={paletteActiveIndex}
        setQuery={setPaletteQuery} onKeyDown={handlePaletteKeyDown} onClose={() => setPaletteOpen(false)}
        onRun={(entry) => { entry.run(); setPaletteOpen(false); }} />}
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
        {contextMenu.tabId && <>
          <MenuAction icon={<Pin size={14} />} label={tabs.find((tab) => tab.id === contextMenu.tabId)?.pinned ? 'Открепить' : 'Закрепить'} onClick={() => { pinTab(contextMenu.tabId!); setContextMenu(null); }} />
          <MenuAction icon={<X size={14} />} label="Закрыть" onClick={() => { closeTab(contextMenu.tabId!); setContextMenu(null); }} />
          <MenuAction label="Закрыть остальные" onClick={() => closeContextualTabs('others')} />
          <MenuAction label="Закрыть вкладки справа" onClick={() => closeContextualTabs('right')} />
        </>}
        {contextMenu.target && <>
          <MenuAction icon={<Pin size={14} />} label={pinnedItems.some((item) => item.id === contextMenu.target?.id) ? 'Убрать из закреплённого' : 'Закрепить'} onClick={() => setPinned(contextMenu.target!)} />
          {contextMenu.target.kind === 'channel' && <MenuAction icon={<Settings size={14} />} label="Настройки канала" onClick={() => openChannelSettings(contextMenu.target!)} />}
          <MenuAction label="Открыть" onClick={() => { openSidebarTarget(contextMenu.target!); setContextMenu(null); }} />
        </>}
        {contextMenu.server && <>
          <MenuAction icon={<Plus size={14} />} label="Создать канал" onClick={() => openCreateChannel(contextMenu.server!)} />
          <MenuAction icon={<Settings size={14} />} label="Настройки пространства" onClick={() => { setContextMenu(null); openSettingsTab('servers'); }} />
          {contextMenu.server.role !== 'owner' && <MenuAction icon={<LogOut size={14} />} label="Покинуть пространство" onClick={() => void leaveServer(contextMenu.server!)} />}
        </>}
      </ContextMenu>}
      {createSpaceOpen && <div className="modal-backdrop"><motion.form className="modal-panel" onSubmit={(event) => { event.preventDefault(); void createSpace(); }}
        initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .98 }}>
        <header><h2>Новое пространство</h2><button type="button" className="ghost-icon" onClick={() => setCreateSpaceOpen(false)} aria-label="Закрыть"><X size={17} /></button></header>
        <Field label="Название"><Input value={createSpaceName} onChange={(event) => setCreateSpaceName(event.target.value)} minLength={3} maxLength={48} required /></Field>
        <Field label="Описание"><Textarea value={createSpaceDescription} onChange={(event) => setCreateSpaceDescription(event.target.value)} maxLength={240} rows={3} /></Field>
        {createSpaceStatus && <p className="status error">{createSpaceStatus}</p>}
        <button className="primary" type="submit">Создать пространство</button>
      </motion.form></div>}

      {createChannelServerId !== null && <div className="modal-backdrop"><motion.form className="modal-panel" onSubmit={(event) => { event.preventDefault(); void createChannel(); }}
        initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }}>
        <header><h2>Создать канал</h2><button type="button" className="ghost-icon" aria-label="Закрыть" onClick={() => setCreateChannelServerId(null)}><X size={16} /></button></header>
        <Field label="Название"><Input value={createChannelName} onChange={(event) => setCreateChannelName(event.target.value)} minLength={3} maxLength={32} required /></Field>
        <Field label="Тип"><Select value={createChannelType} onChange={(event) => setCreateChannelType(event.target.value as 'text' | 'voice')}><option value="text">Текстовый</option><option value="voice">Голосовой</option></Select></Field>
        {createChannelType === 'voice' && <Field label="Лимит участников"><Select value={createChannelUserLimit} onChange={(event) => setCreateChannelUserLimit(Number(event.target.value))}>{[2,3,4,5,6,7,8].map((limit) => <option key={limit} value={limit}>{limit} участников</option>)}</Select></Field>}
        <Field label="Тема"><Textarea value={createChannelTopic} onChange={(event) => setCreateChannelTopic(event.target.value)} maxLength={240} rows={3} /></Field>
        {createChannelStatus && <p className="status error">{createChannelStatus}</p>}
        <button type="submit" className="primary" disabled={createChannelStatus === 'Создаём канал…'}>Создать канал</button>
      </motion.form></div>}
      {channelEditTarget && <div className="modal-backdrop"><motion.form className="modal-panel" onSubmit={(event) => { event.preventDefault(); void saveChannelSettings(); }}
        initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }}>
        <header><h2>Настройки канала</h2><button type="button" className="ghost-icon" aria-label="Закрыть" onClick={() => setChannelEditTarget(null)}><X size={16} /></button></header>
        <Field label="Название"><Input value={channelEditName} onChange={(event) => setChannelEditName(event.target.value)} minLength={3} maxLength={32} required /></Field>
        <Field label="Тема"><Textarea value={channelEditTopic} onChange={(event) => setChannelEditTopic(event.target.value)} maxLength={256} rows={3} /></Field>
        {channelEditStatus && <p className="status error">{channelEditStatus}</p>}
        <div className="channel-settings-actions">
          <button type="submit" className="primary" disabled={channelEditStatus === 'Сохраняем…' || channelEditStatus === 'Удаляем канал…'}>Сохранить</button>
          {!channelDeleteConfirm
            ? <button type="button" className="ghost danger" onClick={() => setChannelDeleteConfirm(true)}>Удалить канал</button>
            : <div className="channel-delete-confirm"><span>Удалить канал и все его сообщения?</span>
                <button type="button" className="ghost" onClick={() => setChannelDeleteConfirm(false)}>Отмена</button>
                <button type="button" className="danger" onClick={() => void deleteChannel()}>Подтвердить удаление</button>
              </div>}
        </div>
      </motion.form></div>}
      {pendingVoiceInvite && <div className="modal-backdrop">
        <motion.section className="modal-panel voice-incoming-invite" role="dialog" aria-modal="true" aria-label="Приглашение в голосовой канал"
          initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }}>
          <header><h2>Приглашение в голосовой канал</h2><button type="button" className="ghost-icon" aria-label="Закрыть" onClick={() => {
            getSocket().emit('voice:invite-response', { to: pendingVoiceInvite.from, channelId: pendingVoiceInvite.channelId, accepted: false });
            setPendingVoiceInvite(null);
          }}><X size={16} /></button></header>
          <div className="voice-invite-from"><Avatar user={pendingVoiceInvite.user} size={44} /><span><strong>{pendingVoiceInvite.user.display_name || pendingVoiceInvite.user.username}</strong><small>{pendingVoiceInvite.serverName} · {pendingVoiceInvite.channelName}</small></span></div>
          <div className="voice-invite-actions">
            <button type="button" className="ghost danger" onClick={() => {
              getSocket().emit('voice:invite-response', { to: pendingVoiceInvite.from, channelId: pendingVoiceInvite.channelId, accepted: false });
              setPendingVoiceInvite(null);
            }}>Отклонить</button>
            <button type="button" className="primary" onClick={() => {
              const server = servers.find((item) => item.id === pendingVoiceInvite.serverId);
              const accepted = server ? openVoiceTab(server, pendingVoiceInvite.channelId) : false;
              if (!accepted) return;
              getSocket().emit('voice:invite-response', { to: pendingVoiceInvite.from, channelId: pendingVoiceInvite.channelId, accepted: true });
              setPendingVoiceInvite(null);
            }}>Принять</button>
          </div>
        </motion.section>
      </div>}
      {notificationUpdate && <div className="update-toast"><span>{notificationUpdate.message}</span>
        <button className="primary tiny" onClick={() => openSettingsTab('updates')}>Обновить</button>
        <button className="ghost-icon" aria-label="Позже" onClick={() => setNotificationUpdate(null)}><X size={14} /></button>
      </div>}

      {welcomeKind && <WelcomeOverlay kind={welcomeKind} name={welcomeName} onClose={() => setWelcomeKind(null)} />}
    </div>
  );
}

function formatCallDuration(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(total / 60).toString().padStart(2, '0');
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function HashIcon() { return <span className="hash-icon">#</span>; }

function SidebarSection({ title, count, collapsed, onToggle, action, children }: {
  title: string; count: number; collapsed: boolean; onToggle: () => void; action?: ReactNode; children: ReactNode;
}) {
  return <section className="sidebar-section">
    <header><button type="button" className="sidebar-section-toggle" onClick={onToggle}>
      {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<span>{title}</span><small>{count}</small>
    </button>{action}</header>
    {!collapsed && <div className="sidebar-section-body">{children}</div>}
  </section>;
}

function SidebarTarget({ item, onClick, onContextMenu }: { item: SidebarPin; onClick: () => void; onContextMenu: (event: MouseEvent) => void }) {
  return <button type="button" className="sidebar-row" onClick={onClick} onContextMenu={onContextMenu}>
    {item.kind === 'dm' ? <MessageCircle size={15} /> : <HashIcon />}<span className="sidebar-row-text"><strong>{item.title}</strong></span>
  </button>;
}

function HomeView({ user, conversations, servers, unreadDmCounts, unreadChannelCounts, openFriends, openPalette, openDm, openChannel }: {
  user: User; conversations: Conversation[]; servers: Server[];
  unreadDmCounts: Record<number, number>; unreadChannelCounts: Record<number, number>;
  openFriends: () => void; openPalette: () => void;
  openDm: (conversation: Conversation) => void; openChannel: (server: Server, channelId: number) => void;
}) {
  const recent = conversations.slice(0, 6);
  const channels = servers.flatMap((server) => server.channels
    .filter((channel) => channel.type === 'text')
    .slice(0, 3)
    .map((channel) => ({ server, channel }))).slice(0, 6);
  const [lastItems, setLastItems] = useState<Record<string, { content: string; created_at: string; authorId?: number }>>({});

  useEffect(() => {
    let cancelled = false;
    async function loadChannelPreviews() {
      const entries = await Promise.all(channels.map(async ({ server, channel }) => {
        try {
          const response = await apiFetch(`/api/servers/${server.id}/channels/${channel.id}/messages?limit=1`);
          if (!response.ok) return null;
          const payload = await response.json();
          const message = (payload.messages || []).slice(-1)[0];
          if (!message) return null;
          const content = message.content?.trim() || (message.attachment?.mime?.startsWith('image/') ? 'Фото' : message.attachment ? `Файл: ${message.attachment.name}` : 'Сообщение');
          return [`channel:${channel.id}`, { content, created_at: message.created_at, authorId: message.author?.id }] as const;
        } catch { return null; }
      }));
      if (!cancelled) {
        const next: Record<string, { content: string; created_at: string; authorId?: number }> = {};
        for (const entry of entries) if (entry) next[entry[0]] = entry[1];
        setLastItems(next);
      }
    }
    void loadChannelPreviews();
    return () => { cancelled = true; };
  }, [servers]);

  const formatTime = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
  };
  const dmPreview = (conversation: Conversation) => {
    const message = conversation.last_message;
    if (!message) return 'Личный диалог';
    const content = message.content?.trim() || (message.attachment?.mime?.startsWith('image/') ? 'Фото' : message.attachment ? `Файл: ${message.attachment.name}` : 'Сообщение');
    return message.author.id === user.id ? `Вы: ${content}` : content;
  };
  const hasItems = recent.length > 0 || channels.length > 0;
  return <div className="nexo-home-view">
    <div className="home-welcome">
      <div><h1>Рады видеть, {user.display_name || user.username}</h1>
        <p>Продолжайте разговоры и возвращайтесь к своим проектам.</p></div>
      <button type="button" className="primary" onClick={openPalette}><Command size={16} />Быстрый переход <kbd>Ctrl K</kbd></button>
    </div>
    <section className="home-continue">
      <h2>Продолжить</h2>
      {hasItems ? <div className="home-continue-list">
        {recent.map((conversation) => {
          const person = conversation.counterpart || conversation.participants.find((participant) => participant.id !== user.id);
          const name = person?.display_name || person?.username || conversation.title || 'Диалог';
          const message = conversation.last_message;
          const unread = unreadDmCounts[conversation.id] || 0;
          return <button key={`dm-${conversation.id}`} type="button" onClick={() => openDm(conversation)}>
            <Avatar user={person} size={36} showStatus />
            <span><strong>{name}</strong><small>{dmPreview(conversation)}</small></span>
            {message && <time>{formatTime(message.created_at)}</time>}
            {unread > 0 && <span className="home-unread">{unread > 99 ? '99+' : unread}</span>}
            <ChevronRight size={15} />
          </button>;
        })}
        {channels.map(({ server, channel }) => {
          const preview = lastItems[`channel:${channel.id}`];
          const unread = unreadChannelCounts[channel.id] || 0;
          return <button key={`channel-${channel.id}`} type="button" onClick={() => openChannel(server, channel.id)}>
            <span className="home-channel-avatar"><HashIcon /></span>
            <span><strong>{channel.name}</strong><small>{preview ? `${preview.authorId === user.id ? 'Вы: ' : ''}${preview.content}` : server.name}</small></span>
            {preview && <time>{formatTime(preview.created_at)}</time>}
            {unread > 0 && <span className="home-unread">{unread > 99 ? '99+' : unread}</span>}
            <ChevronRight size={15} />
          </button>;
        })}
      </div> : <div className="home-empty">
        <MessageCircle size={22} /><strong>Пока здесь тихо</strong>
        <p>Добавьте друга, чтобы начать общение.</p>
        <button className="primary tiny" onClick={openFriends}>Найти друга</button>
      </div>}
    </section>
  </div>;
}

function CommandPalette({ entries, query, activeIndex, setQuery, onKeyDown, onClose, onRun }: {
  entries: PaletteEntry[]; query: string; activeIndex: number; setQuery: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void; onClose: () => void; onRun: (entry: PaletteEntry) => void;
}) {
  const filtered = entries.filter((entry) => fuzzyMatch(`${entry.title} ${entry.subtitle || ''}`, query));
  let index = -1;
  return <div className="command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.div className="command-palette" initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .99 }}>
      <div className="command-search"><Search size={18} /><Input className="command-palette-input" value={query} onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown} placeholder="Куда перейти или что выполнить?" /><kbd>ESC</kbd></div>
      <div className="command-results">
        {['Диалоги', 'Друзья', 'Каналы', 'Действия'].map((group) => {
          const groupItems = filtered.filter((entry) => entry.group === group);
          if (!groupItems.length) return null;
          return <section key={group}><p>{group}</p>{groupItems.map((entry) => {
            index += 1;
            const currentIndex = index;
            return <button key={entry.id} type="button" className={currentIndex === activeIndex ? 'active' : ''}
              onMouseEnter={() => { /* keyboard index remains deterministic */ }} onClick={() => onRun(entry)}>
              <span>{entry.icon}</span><strong>{entry.title}</strong>{entry.subtitle && <small>{entry.subtitle}</small>}
              <CornerDownLeft size={13} />
            </button>;
          })}</section>;
        })}
        {!filtered.length && <div className="command-no-results">Ничего не найдено</div>}
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> Навигация</span><span><kbd>Enter</kbd> Открыть</span><span><kbd>Esc</kbd> Закрыть</span></footer>
    </motion.div>
  </div>;
}

function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const close = () => onClose();
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); };
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 230);
  const top = Math.min(y, window.innerHeight - 210);
  return <div className="nexo-context-menu" style={{ left, top }} onPointerDown={(event) => event.stopPropagation()}>{children}</div>;
}

function MenuAction({ icon, label, onClick }: { icon?: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick}>{icon}<span>{label}</span></button>;
}

function WelcomeOverlay({ kind, name, onClose }: { kind: 'back' | 'new'; name: string; onClose: () => void }) {
  return <motion.div className="welcome-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
    <motion.div className="welcome-content" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 95, damping: 18 }}>
      <div className="welcome-copy">
        <motion.h1 initial={{ opacity: 0, filter: 'blur(6px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: .9 }}>
          {kind === 'back' ? 'Рады видеть снова,' : 'Добро пожаловать,'}
        </motion.h1>
        <motion.strong initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .35, duration: .65 }}>{name}</motion.strong>
      </div>
      <motion.span className="welcome-line center" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
        transition={{ delay: .35, duration: .9, ease: [0.22, 1, 0.36, 1] }} />
    </motion.div>
  </motion.div>;
}
