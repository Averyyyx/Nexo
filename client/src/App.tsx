import { useEffect, useState, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LoginPanel } from './components/LoginPanel';
import { MessengerPreview } from './components/MessengerPreview';
import { ProfileSetup } from './components/ProfileSetup';
import { MessengerWorkspace } from './components/MessengerWorkspace';
import { FriendsList } from './components/FriendsList';
import { VoiceChannel } from './components/VoiceChannel';
import { apiFetch } from './lib/api';
import { webRTCService } from './lib/webrtc';
import type { User } from './types';

const themes = ['nebula', 'midnight', 'lilac'] as const;

function pickNextTheme(current: typeof themes[number]) {
  const index = themes.indexOf(current);
  return themes[(index + 1) % themes.length];
}

export default function App() {
  const [theme, setTheme] = useState<(typeof themes)[number]>('nebula');
  const [isPreviewFocused, setIsPreviewFocused] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  
  // Friends and voice call state
  const [activeView, setActiveView] = useState<'friends' | 'messages'>('messages');
  const [isVoiceChatOpen, setIsVoiceChatOpen] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<number, MediaStream>>({});
  const [, setVoiceStates] = useState<Record<number, { self_mute: boolean; self_deaf: boolean; self_video: boolean }>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [userVolumes, setUserVolumes] = useState<Record<number, number>>({});
  

  useEffect(() => {
    async function bootstrapSession() {
      try {
        const response = await apiFetch('/api/auth/session');
        if (response.ok) {
          const payload = await response.json();
          setUser(payload.user ?? null);
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setLoadingSession(false);
      }
    }

    bootstrapSession();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Initialize WebRTC service
    webRTCService.connect(user.id);

    // Set up event listeners
    const handleRemoteStream = (userId: number, stream: MediaStream) => {
      setRemoteStreams(prev => ({
        ...prev,
        [userId]: stream,
      }));
    };

    const handleCallEnded = () => {
      setRemoteStreams({});
      setLocalStream(null);
      setIsVoiceChatOpen(false);
    };

    const handleVoiceStateUpdate = (userId: number, state: { self_mute?: boolean; self_deaf?: boolean; self_video?: boolean }) => {
      setVoiceStates(prev => ({
        ...prev,
        [userId]: {
          ...(prev[userId] || {}),
          ...state,
        },
      }));
    };

    webRTCService.onRemoteStream(handleRemoteStream);
    webRTCService.onCallEnded(handleCallEnded);
    webRTCService.onVoiceStateUpdate(handleVoiceStateUpdate);

    return () => {
      webRTCService.disconnect();
    };
  }, [user]);

  const backgroundClass = useMemo<string>(() => {
    switch (theme) {
      case 'midnight':
        return 'app-surface midnight';
      case 'lilac':
        return 'app-surface lilac';
      default:
        return 'app-surface nebula';
    }
  }, [theme]);

  const stage: 'login' | 'profile' | 'social' = useMemo(() => {
    if (!user) return 'login';
    return user.profile_complete ? 'social' : 'profile';
  }, [user]);

  const panelKey = `${stage}-${theme}`;
  const previewActive = stage === 'social' ? true : isPreviewFocused;

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', {
        method: 'POST'
      });
    } finally {
      setUser(null);
    }
  }

  // Handle theme change
  const handleThemeChange = useCallback(() => {
    setTheme(pickNextTheme(theme));
  }, [theme]);

  // Prepare participants for VoiceChannel component
  const voiceParticipants = useMemo(() => {
    return Object.entries(remoteStreams).map(([userId, stream]) => {
      const id = Number(userId);
      return {
        user: { 
          id, 
          username: `User ${userId}`, 
          display_name: `User ${userId}`,
          avatar_url: '',
          status: 'online'
        },
        voiceState: {
          user_id: id,
          channel_id: 1,
          session_id: '',
          deaf: false,
          mute: false,
          self_deaf: isDeafened,
          self_mute: isMuted,
          self_video: isScreenSharing,
          suppress: false,
          request_to_speak_timestamp: null,
        },
        stream,
      };
    });
  }, [remoteStreams, isMuted, isDeafened, isScreenSharing]);

  // Handle screen sharing
  const toggleScreenShare = useCallback(async () => {
    try {
      const isSharing = await webRTCService.toggleScreenShare();
      setIsScreenSharing(isSharing);
    } catch (error) {
      console.error('Error toggling screen share:', error);
    }
  }, []);

  // Handle disconnecting from voice chat
  const disconnectVoiceChat = useCallback(() => {
    webRTCService.endCall();
    setLocalStream(null);
    setRemoteStreams({});
    setIsVoiceChatOpen(false);
  }, []);

  // Handle volume change for a user
  const handleUserVolumeChange = useCallback((userId: number, volume: number) => {
    setUserVolumes(prev => ({
      ...prev,
      [userId]: volume,
    }));
    // Update volume in WebRTC service
    webRTCService.updateUserVolume(userId, volume);
  }, []);

  return (
    <div className={`min-h-screen flex flex-col ${backgroundClass}`}>
      <motion.header
        className="app-nav"
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <div className="brand">
          <span className="pulse-dot" />
          <strong>Vencord</strong>
          <span className="tagline">new era of presence</span>
        </div>
        <div className="nav-actions">
          {stage === 'social' && (
            <button className="ghost subtle" onClick={handleLogout}>
              Выйти
            </button>
          )}
          <button className="ghost" onClick={handleThemeChange}>
            Cycle theme
          </button>
          <button className="primary">Get early access</button>
        </div>
      </motion.header>

      <main className="app-stage">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={panelKey}
            className={`panel ${stage} ${
              stage === 'login' && isPreviewFocused ? 'dimmed' : ''
            }`}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            onMouseEnter={() => stage === 'login' && setIsPreviewFocused(false)}
            onMouseLeave={() => stage === 'login' && setIsPreviewFocused(true)}
          >
            {loadingSession && (
              <div className="panel-loading">
                <p>Загружаем сессию…</p>
              </div>
            )}

            {!loadingSession && stage === 'login' && (
              <LoginPanel
                theme={theme}
                onSuccess={(nextUser) => {
                  setUser(nextUser);
                }}
              />
            )}

            {!loadingSession && stage === 'profile' && user && (
              <ProfileSetup
                user={user}
                onComplete={(updatedUser) => {
                  setUser(updatedUser);
                }}
              />
            )}

            {!loadingSession && stage === 'social' && user && (
              <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <div className="w-16 bg-gray-900 flex flex-col items-center py-4">
                  <button
                    onClick={() => setActiveView('messages')}
                    className={`p-3 rounded-2xl mb-2 ${activeView === 'messages' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setActiveView('friends')}
                    className={`p-3 rounded-2xl ${activeView === 'friends' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </button>
                </div>

                {/* Main content */}
                <div className="flex-1 flex overflow-hidden">
                  {/* Friends list or server list */}
                  <div className="w-60 bg-gray-800 flex flex-col border-r border-gray-700">
                    {activeView === 'friends' ? (
                      <FriendsList
                        onSelectFriend={() => {
                          setActiveView('messages');
                        }}
                      />
                    ) : (
                      <div className="p-4">
                        <h2 className="text-white font-bold text-lg mb-4">Серверы</h2>
                        {/* Server list would go here */}
                      </div>
                    )}
                  </div>

                  {/* Main chat area */}
                  <div className="flex-1 flex flex-col bg-gray-700">
                    {activeView === 'messages' ? (
                      <MessengerWorkspace user={user} />
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-gray-400">
                        <div className="text-center">
                          <div className="text-6xl mb-4">👋</div>
                          <h3 className="text-xl font-semibold mb-2">Добро пожаловать в Vencord!</h3>
                          <p className="max-w-md">
                            Выберите друга, чтобы начать общение или создать голосовой канал.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Voice chat overlay */}
        {isVoiceChatOpen && (
          <VoiceChannel
            isOpen={isVoiceChatOpen}
            onClose={disconnectVoiceChat}
            participants={voiceParticipants}
            localStream={localStream}
            onMuteToggle={(muted) => {
              setIsMuted(muted);
              webRTCService.toggleMute(muted);
            }}
            onDeafenToggle={(deafened) => {
              setIsDeafened(deafened);
              webRTCService.toggleDeafen(deafened);
            }}
            onScreenShareToggle={toggleScreenShare}
            onDisconnect={disconnectVoiceChat}
            onUserVolumeChange={handleUserVolumeChange}
          />
        )}

        {/* Hidden audio elements for remote streams */}
        {Object.entries(remoteStreams).map(([userId, stream]) => (
          <audio
            key={userId}
            id={`audio-${userId}`}
            autoPlay
            playsInline
            ref={(el) => {
              if (el) {
                el.srcObject = stream;
                el.volume = userVolumes[parseInt(userId, 10)] || 1;
              }
            }}
          />
        ))}

        <motion.div
          className="panel preview"
          layout
          transition={{ type: 'spring', stiffness: 80, damping: 16 }}
          onMouseEnter={() => stage === 'login' && setIsPreviewFocused(true)}
        >
          <MessengerPreview theme={theme} isFocused={previewActive} />
        </motion.div>
      </main>
    </div>
  );
}
