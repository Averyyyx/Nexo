import { useState, useRef, useEffect } from 'react';
import type { FC } from 'react';
import type { VoiceState } from '../../types';

interface ParticipantUser {
  id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  status: string;
}

interface Participant {
  user: ParticipantUser;
  voiceState: VoiceState;
  stream?: MediaStream;
}

interface VoiceChannelProps {
  isOpen: boolean;
  onClose: () => void;
  participants: Participant[];
  localStream: MediaStream | null;
  onMuteToggle: (muted: boolean) => void;
  onDeafenToggle: (deafened: boolean) => void;
  onScreenShareToggle: () => void;
  onDisconnect: () => void;
  onUserVolumeChange: (userId: number, volume: number) => void;
}

export const VoiceChannel: FC<VoiceChannelProps> = ({
  isOpen,
  onClose,
  participants,
  localStream,
  onMuteToggle,
  onDeafenToggle,
  onScreenShareToggle,
  onDisconnect,
  onUserVolumeChange,
}) => {
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [videoQuality, setVideoQuality] = useState('720p');
  const [activeSpeaker, setActiveSpeaker] = useState<number | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Update local video stream when it changes
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Update participant video streams when they change
  useEffect(() => {
    participants.forEach(({ user, stream }) => {
      const video = videoRefs.current[user.id];
      if (video && stream) {
        video.srcObject = stream;
      }
    });
  }, [participants]);

  // Handle active speaker detection
  useEffect(() => {
    if (participants.length === 0) return;

    const speakingParticipants = participants.filter(
      (p) => !p.voiceState.self_mute && !p.voiceState.mute && p.voiceState.channel_id
    );

    if (speakingParticipants.length > 0) {
      setActiveSpeaker(speakingParticipants[0].user.id);
    } else {
      setActiveSpeaker(null);
    }
  }, [participants]);

  const handleMuteToggle = () => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    onMuteToggle(newMutedState);
  };

  const handleDeafenToggle = () => {
    const newDeafenedState = !isDeafened;
    setIsDeafened(newDeafenedState);
    onDeafenToggle(newDeafenedState);
  };

  const handleScreenShareToggle = () => {
    const newScreenShareState = !isScreenSharing;
    setIsScreenSharing(newScreenShareState);
    onScreenShareToggle();
  };

  const handleVideoQualityChange = (quality: string) => {
    setVideoQuality(quality);
    // Here you would typically update the video quality settings
    console.log('Video quality set to:', quality);
  };

  const handleUserVolumeChange = (userId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseFloat(e.target.value);
    onUserVolumeChange(Number(userId), volume);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-90 z-50 flex flex-col">
      <div className="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white">Голосовой канал</h2>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-white transition-colors"
          aria-label="Закрыть"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Local user video */}
          <div className="relative bg-gray-800 rounded-lg overflow-hidden">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted={isMuted}
              className="w-full h-full aspect-video object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
              <div className="text-white font-medium">
                Вы {isMuted && '🔇'} {isDeafened && '🔇'}
              </div>
            </div>
          </div>

          {/* Remote participants */}
          {participants.map(({ user, voiceState, stream }) => (
            <div
              key={user.id}
              className={`relative bg-gray-800 rounded-lg overflow-hidden transition-all ${
                activeSpeaker === user.id ? 'ring-2 ring-green-500' : ''
              }`}
            >
              <video
                ref={(el) => {
                  if (el) {
                    videoRefs.current[user.id] = el;
                    if (stream) {
                      el.srcObject = stream;
                    }
                  }
                }}
                autoPlay
                playsInline
                muted={false}
                className="w-full h-full aspect-video object-cover"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                <div className="text-white font-medium">
                  {user.display_name || user.username}
                  {voiceState.self_mute && ' 🔇'}
                  {voiceState.mute && ' 🔇'}
                </div>
                <div className="flex items-center mt-1">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    defaultValue="1"
                    onChange={(e) => handleUserVolumeChange(user.id.toString(), e)}
                    className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>
              {activeSpeaker === user.id && (
                <div className="absolute top-2 right-2 w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-800 border-t border-gray-700 p-3">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <button
            onClick={handleMuteToggle}
            className={`p-3 rounded-full ${
              isMuted ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            } transition-colors`}
            aria-label={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isMuted ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                  clipRule="evenodd"
                />
              )}
            </svg>
          </button>

          <button
            onClick={handleDeafenToggle}
            className={`p-3 rounded-full ${
              isDeafened ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            } transition-colors`}
            aria-label={isDeafened ? 'Включить звук' : 'Выключить звук'}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                clipRule="evenodd"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
              />
            </svg>
          </button>

          <div className="relative">
            <button
              onClick={handleScreenShareToggle}
              className={`p-3 rounded-full ${
                isScreenSharing ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              } transition-colors`}
              aria-label={isScreenSharing ? 'Остановить демонстрацию экрана' : 'Начать демонстрацию экрана'}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
                />
              </svg>
            </button>
            {isScreenSharing && (
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 bg-gray-800 rounded-lg shadow-lg p-2">
                <div className="text-xs text-gray-300 mb-1">Качество видео</div>
                <select
                  value={videoQuality}
                  onChange={(e) => handleVideoQualityChange(e.target.value)}
                  className="bg-gray-700 text-white text-sm rounded p-1 w-full"
                >
                  <option value="360p">360p (SD)</option>
                  <option value="480p">480p (SD)</option>
                  <option value="720p">720p (HD)</option>
                  <option value="1080p">1080p (Full HD)</option>
                </select>
              </div>
            )}
          </div>

          <button
            onClick={onDisconnect}
            className="p-3 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors"
            aria-label="Покинуть звонок"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16.348 16.023a9 9 0 11-12.696 0m12.696 0l-3.75-3.75m3.75 3.75l3.75 3.75"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceChannel;
