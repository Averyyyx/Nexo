export type ChannelPermissionOverride = {
  target_type: 'role' | 'member';
  target_id: number;
  allow: number;
  deny: number;
};

export type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export type User = {
  id: number;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string;
  discriminator?: string;
  profile_complete: number;
  status: UserStatus;
  custom_status?: string;
  last_online?: string;
};

export type Friend = {
  id: number;
  user: User;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
};

export type FriendRequest = {
  id: number;
  from: User;
  to: User;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
};

export type VoiceState = {
  user_id: number;
  channel_id: number | null;
  session_id: string;
  deaf: boolean;
  mute: boolean;
  self_deaf: boolean;
  self_mute: boolean;
  self_video: boolean;
  suppress: boolean;
  request_to_speak_timestamp: string | null;
};

export type FriendRecord = {
  id: number;
  status: 'pending' | 'accepted';
  direction: 'incoming' | 'outgoing';
  created_at: string;
  user: User;
};

export type FriendPayload = {
  incoming: FriendRecord[];
  outgoing: FriendRecord[];
  friends: FriendRecord[];
};

export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
};

export type MessageAuthor = {
  id: number;
  username: string;
  display_name: string;
  avatar_url: string;
};

export type Message = {
  id: number;
  conversation_id: number;
  author: MessageAuthor;
  content: string | null;
  attachment: Attachment | null;
  created_at: string;
};

export type Conversation = {
  id: number;
  type: 'dm' | 'group' | string;
  title: string | null;
  participants: User[];
  counterpart?: User | null;
  updated_at: string;
};

export type Channel = {
  id: number;
  server_id: number;
  type: 'text' | 'voice' | string;
  name: string;
  topic: string;
  position: number;
  slow_mode_seconds: number;
  is_nsfw: boolean;
  bitrate: number;
  user_limit: number;
  soundscape: string;
  overrides?: ChannelPermissionOverride[];
  created_at: string;
};

export type ServerRole = {
  id: number;
  name: string;
  color: string;
  position: number;
  permissions: number;
  is_default: boolean;
};

export type VoiceParticipant = {
  user: MessageAuthor;
  muted: boolean;
  deafened: boolean;
  joined_at: string;
};

export type Server = {
  id: number;
  name: string;
  icon: string;
  description: string;
  owner_id: number;
  role: string;
  roles: ServerRole[];
  channels: Channel[];
  created_at: string;
};

export type ChannelMessage = {
  id: number;
  server_id: number;
  channel_id: number;
  author: MessageAuthor;
  content: string | null;
  attachment: Attachment | null;
  created_at: string;
};

