import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { User, MessageAuthor, UserStatus } from '../types';
import { DefaultAvatar } from './DefaultAvatar';

type AvatarUser = Partial<Pick<User, 'id' | 'username' | 'display_name' | 'avatar_url' | 'avatar_color' | 'avatar_preset' | 'status'>> &
  Partial<Pick<MessageAuthor, 'username' | 'display_name' | 'avatar_url' | 'avatar_color' | 'avatar_preset'>>;

type AvatarProps = {
  user?: AvatarUser | null;
  name?: string;
  size?: number;
  showStatus?: boolean;
  className?: string;
};

const statusClass: Record<UserStatus, string> = {
  online: 'online', idle: 'idle', dnd: 'dnd', invisible: 'offline', offline: 'offline'
};

export function Avatar({ user, name, size = 36, showStatus = false, className = '' }: AvatarProps) {
  const title = name || user?.display_name || user?.username || 'Nexo user';
  const initial = useMemo(() => Array.from(title.trim())[0]?.toLocaleUpperCase('ru-RU') || 'N', [title]);
  const style: CSSProperties = {
    width: size,
    height: size,
    minWidth: size,
    backgroundColor: user?.avatar_color || 'var(--accent)',
    fontSize: Math.max(12, Math.round(size * 0.38))
  };

  return (
    <span className={`nexo-avatar ${className}`} style={style} data-tooltip={title} aria-label={title}>
      {user?.avatar_url
        ? <img src={user.avatar_url} alt="" draggable={false} />
        : Number.isInteger(user?.avatar_preset)
          ? <DefaultAvatar preset={user?.avatar_preset} size={size} />
          : <span>{initial}</span>}
      {showStatus && (
        <i className={`nexo-avatar-status ${statusClass[user?.status || 'offline']}`} aria-label={user?.status || 'offline'} />
      )}
    </span>
  );
}
