import { io, Socket } from 'socket.io-client';
import type { User, VoiceState } from '../types';

interface WebRTCService {
  connect: (userId: number) => void;
  startCall: (friend: User) => Promise<MediaStream>;
  endCall: () => void;
  toggleMute: (muted: boolean) => void;
  toggleDeafen: (deafened: boolean) => void;
  toggleScreenShare: () => Promise<boolean>;
  onRemoteStream: (callback: (userId: number, stream: MediaStream) => void) => void;
  onCallEnded: (callback: () => void) => void;
  onVoiceStateUpdate: (callback: (userId: number, state: Partial<VoiceState>) => void) => void;
  updateUserVolume: (userId: number, volume: number) => void;
  disconnect: () => void;
}

export class WebRTCServiceImpl implements WebRTCService {
  private socket: Socket | null = null;
  private peerConnections: Record<number, RTCPeerConnection> = {};
  private localStream: MediaStream | null = null;
  private screenShareStream: MediaStream | null = null;
  private remoteStreamCallbacks: ((userId: number, stream: MediaStream) => void)[] = [];
  private callEndedCallbacks: (() => void)[] = [];
  private voiceStateUpdateCallbacks: ((userId: number, state: Partial<VoiceState>) => void)[] = [];
  private userVolumes: Record<number, number> = {};
  private configuration: RTCConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  };

  constructor() {
    this.handleIceCandidate = this.handleIceCandidate.bind(this);
    this.handleTrack = this.handleTrack.bind(this);
    this.handleConnectionStateChange = this.handleConnectionStateChange.bind(this);
  }

  connect(userId: number): void {
    this.socket = io('http://localhost:3001', {
      auth: { userId },
    });

    this.socket.on('connect', () => {
      console.log('Connected to WebSocket server');
    });

    this.socket.on('offer', this.handleOffer.bind(this));
    this.socket.on('answer', this.handleAnswer.bind(this));
    this.socket.on('ice-candidate', this.handleRemoteIceCandidate.bind(this));
    this.socket.on('voiceStateUpdate', (data: { userId: number; voiceState: VoiceState }) => {
      this.voiceStateUpdateCallbacks.forEach(cb => cb(data.userId, data.voiceState));
    });
  }

  async startCall(friend: User): Promise<MediaStream> {
    if (!this.socket) throw new Error('Not connected to signaling server');
    
    try {
      // Get user media
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      
      // Create peer connection
      const pc = new RTCPeerConnection(this.configuration);
      this.peerConnections[friend.id] = pc;
      
      // Add local stream to connection
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
      
      // Set up event handlers
      pc.onicecandidate = (event) => this.handleIceCandidate(event, friend.id);
      pc.ontrack = this.handleTrack;
      pc.onconnectionstatechange = this.handleConnectionStateChange;
      
      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      this.socket.emit('offer', {
        to: friend.id,
        offer: pc.localDescription,
      });
      
      return this.localStream;
    } catch (error) {
      console.error('Error starting call:', error);
      this.cleanup();
      throw error;
    }
  }

  endCall(): void {
    this.cleanup();
    this.callEndedCallbacks.forEach(cb => cb());
  }

  toggleMute(muted: boolean): void {
    if (!this.localStream) return;
    
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !muted;
    });
    
    this.notifyVoiceStateUpdate({ self_mute: muted });
  }

  toggleDeafen(deafened: boolean): void {
    if (!this.localStream) return;
    
    // Mute all remote audio when deafened
    Object.values(this.peerConnections).forEach(pc => {
      pc.getReceivers().forEach(receiver => {
        if (receiver.track.kind === 'audio') {
          receiver.track.enabled = !deafened;
        }
      });
    });
    
    this.notifyVoiceStateUpdate({ self_deaf: deafened });
  }

  async toggleScreenShare(): Promise<boolean> {
    try {
      if (this.screenShareStream) {
        // Stop screen sharing
        this.screenShareStream.getTracks().forEach(track => track.stop());
        this.screenShareStream = null;
        
        // Switch back to camera
        if (this.localStream) {
          const videoTrack = this.localStream.getVideoTracks()[0];
          if (videoTrack) {
            videoTrack.enabled = true;
          }
        }
        
        this.notifyVoiceStateUpdate({ self_video: false });
        return false;
      } else {
        // Start screen sharing
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        
        this.screenShareStream = stream;
        
        // Replace video track in all peer connections
        const videoTrack = stream.getVideoTracks()[0];
        Object.values(this.peerConnections).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(videoTrack);
          }
        });
        
        // Disable camera
        if (this.localStream) {
          const videoTrack = this.localStream.getVideoTracks()[0];
          if (videoTrack) {
            videoTrack.enabled = false;
          }
        }
        
        // Handle when user stops sharing screen
        stream.getVideoTracks()[0].onended = () => {
          this.toggleScreenShare();
        };
        
        this.notifyVoiceStateUpdate({ self_video: true });
        return true;
      }
    } catch (error) {
      console.error('Error toggling screen share:', error);
      return !!this.screenShareStream;
    }
  }

  onRemoteStream(callback: (userId: number, stream: MediaStream) => void): void {
    this.remoteStreamCallbacks.push(callback);
  }

  onCallEnded(callback: () => void): void {
    this.callEndedCallbacks.push(callback);
  }

  onVoiceStateUpdate(callback: (userId: number, state: Partial<VoiceState>) => void): void {
    this.voiceStateUpdateCallbacks.push(callback);
  }

  updateUserVolume(userId: number, volume: number): void {
    this.userVolumes[userId] = volume;
    // Volume is applied when the track is received in handleTrack
  }

  disconnect(): void {
    this.cleanup();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private async handleOffer(data: { from: number; offer: RTCSessionDescriptionInit }): Promise<void> {
    if (!this.socket) return;
    
    try {
      const pc = new RTCPeerConnection(this.configuration);
      this.peerConnections[data.from] = pc;
      
      // Set up event handlers
      pc.onicecandidate = (event) => this.handleIceCandidate(event, data.from);
      pc.ontrack = this.handleTrack;
      pc.onconnectionstatechange = this.handleConnectionStateChange;
      
      // Set remote description
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      
      // Create and send answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      this.socket.emit('answer', {
        to: data.from,
        answer: pc.localDescription,
      });
    } catch (error) {
      console.error('Error handling offer:', error);
      this.cleanup();
    }
  }

  private async handleAnswer(data: { from: number; answer: RTCSessionDescriptionInit }): Promise<void> {
    const pc = this.peerConnections[data.from];
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (error) {
        console.error('Error setting remote description:', error);
      }
    }
  }

  private handleIceCandidate(event: RTCPeerConnectionIceEvent, toUserId: number): void {
    if (event.candidate && this.socket) {
      this.socket.emit('ice-candidate', {
        to: toUserId,
        candidate: event.candidate,
      });
    }
  }

  private async handleRemoteIceCandidate(data: { from: number; candidate: RTCIceCandidateInit }): Promise<void> {
    const pc = this.peerConnections[data.from];
    if (pc && data.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  }

  private handleTrack(event: RTCTrackEvent): void {
    const userId = this.getUserIdByPeerConnection(event.target as RTCPeerConnection);
    if (userId && event.streams && event.streams[0]) {
      // Apply volume if set
      const audioElements = document.getElementsByTagName('audio');
      for (let i = 0; i < audioElements.length; i++) {
        if (audioElements[i].id === `audio-${userId}`) {
          audioElements[i].srcObject = event.streams[0];
          audioElements[i].volume = this.userVolumes[userId] || 1;
          break;
        }
      }
      
      this.remoteStreamCallbacks.forEach(cb => cb(userId, event.streams[0]));
    }
  }

  private handleConnectionStateChange(event: Event): void {
    const pc = event.target as RTCPeerConnection;
    console.log('Connection state changed:', pc.connectionState);
    
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      const userId = this.getUserIdByPeerConnection(pc);
      if (userId) {
        delete this.peerConnections[userId];
      }
      
      // If no more connections, end the call
      if (Object.keys(this.peerConnections).length === 0) {
        this.endCall();
      }
    }
  }

  private getUserIdByPeerConnection(pc: RTCPeerConnection): number | null {
    for (const [userId, connection] of Object.entries(this.peerConnections)) {
      if (connection === pc) {
        return parseInt(userId, 10);
      }
    }
    return null;
  }

  private notifyVoiceStateUpdate(state: Partial<VoiceState>): void {
    if (!this.socket) return;
    this.socket.emit('voiceStateUpdate', state);
  }

  private cleanup(): void {
    // Stop all tracks in local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    // Stop screen sharing if active
    if (this.screenShareStream) {
      this.screenShareStream.getTracks().forEach(track => track.stop());
      this.screenShareStream = null;
    }
    
    // Close all peer connections
    Object.values(this.peerConnections).forEach(pc => pc.close());
    this.peerConnections = {};
    
    // Clear callbacks
    this.remoteStreamCallbacks = [];
    this.callEndedCallbacks = [];
    this.voiceStateUpdateCallbacks = [];
  }
}

// Export a singleton instance
export const webRTCService = new WebRTCServiceImpl();
