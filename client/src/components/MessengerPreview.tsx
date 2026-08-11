import { motion } from 'framer-motion';
import {
  Crown,
  Hash,
  Headphones,
  Mic,
  Phone,
  Plus,
  Settings,
  Users
} from 'lucide-react';

type MessengerPreviewProps = {
  theme: 'nebula' | 'midnight' | 'lilac';
  isFocused: boolean;
};

const servers = [
  { name: 'Design', accent: '#8B5CF6' },
  { name: 'Dev', accent: '#10B981' },
  { name: 'Labs', accent: '#F472B6' },
  { name: 'IRL', accent: '#FBBF24' }
];

const textChannels = [
  { name: 'launch-room', unread: 4 },
  { name: 'design-sync', unread: 0 }
];

const voiceChannels = [
  { name: 'daily-call', active: true },
  { name: 'music-zone', active: false }
];

const mockMessages = [
  {
    author: 'Lena',
    role: 'art-director',
    time: '09:24',
    content:
      'Выложила новую подборку звуков и ambient FX. Они синхронизированы с кривыми анимаций.'
  },
  {
    author: 'Artem',
    role: 'lead-dev',
    time: '09:26',
    content: 'Обновил presence API. Теперь статусы рендерятся через streaming payload, задержки <120мс.'
  },
  {
    author: 'Mila',
    role: 'community',
    time: '09:27',
    content: 'Проверяю UX на мобильном. Лайаут скомпенсировал баг на iOS 18, можно выкатывать.'
  }
];

export function MessengerPreview({ theme, isFocused }: MessengerPreviewProps) {
  return (
    <div className={`messenger-shell ${theme} ${isFocused ? 'focused' : ''}`}>
      <ServerRail />
      <ChannelSidebar />
      <ConversationPane />
      <RightDock />
    </div>
  );
}

function ServerRail() {
  return (
    <aside className="server-rail">
      <motion.div
        className="server-pill active"
        layout
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      />
      {servers.map((server) => (
        <motion.button
          key={server.name}
          className="server-icon"
          style={{ background: server.accent }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.96 }}
        >
          {server.name[0]}
        </motion.button>
      ))}
      <button className="server-icon ghost">
        <Plus size={18} />
      </button>
    </aside>
  );
}

function ChannelSidebar() {
  return (
    <section className="channel-column">
      <div className="channel-header">
        Orbit Studio
        <button className="ghost-icon">
          <Crown size={16} />
        </button>
      </div>
      <div className="channel-group">
        <p className="group-title">text</p>
        {textChannels.map((channel) => (
          <button key={channel.name} className={`channel ${channel.unread ? 'unread' : ''}`}>
            <Hash size={14} />
            {channel.name}
            {channel.unread ? <span className="badge">{channel.unread}</span> : null}
          </button>
        ))}
      </div>
      <div className="channel-group">
        <p className="group-title">voice</p>
        {voiceChannels.map((channel) => (
          <button key={channel.name} className={`channel voice ${channel.active ? 'active' : ''}`}>
            <Users size={14} />
            {channel.name}
            {channel.active ? <span className="status-dot" /> : null}
          </button>
        ))}
      </div>
      <footer className="self-card">
        <div>
          <p>Mila</p>
          <small>now listening · wave loops</small>
        </div>
        <div className="controls">
          <button className="ghost-icon">
            <Mic size={16} />
          </button>
          <button className="ghost-icon">
            <Headphones size={16} />
          </button>
          <button className="ghost-icon">
            <Settings size={16} />
          </button>
        </div>
      </footer>
    </section>
  );
}

function ConversationPane() {
  return (
    <section className="conversation">
      <header className="conversation-head">
        <div className="title">
          <Hash size={18} />
          design-sync
        </div>
        <button className="primary tiny">
          <Phone size={14} />
          Join call
        </button>
      </header>

      <div className="message-stream">
        {mockMessages.map((message) => (
          <motion.article
            key={message.time + message.author}
            className="message-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="meta">
              <strong>{message.author}</strong>
              <span className="role">{message.role}</span>
              <time>{message.time}</time>
            </div>
            <p>{message.content}</p>
          </motion.article>
        ))}
      </div>

      <motion.form
        className="composer"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <input placeholder="Поделитесь идеей, ссылкой или закиньте /команду" />
        <button type="button" className="primary">
          Send
        </button>
      </motion.form>
    </section>
  );
}

function RightDock() {
  return (
    <section className="right-dock">
      <motion.div className="call-card" layout>
        <div>
          <p className="label">Now in stage</p>
          <h3>Strategy Retro</h3>
        </div>
        <div className="avatars">
          <span className="avatar" />
          <span className="avatar alt" />
          <span className="avatar tiny" />
        </div>
        <button className="glass">
          <Phone size={16} />
          Listen in
        </button>
      </motion.div>
      <div className="status-card">
        <p>Live reactions</p>
        <div className="pulse-bar">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </section>
  );
}

