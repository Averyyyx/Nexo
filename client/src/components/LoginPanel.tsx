import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Github } from 'lucide-react';
import { API_BASE, apiFetch } from '../lib/api';
import type { User } from '../types';

type AuthMode = 'login' | 'register';

type LoginPanelProps = {
  theme: 'nebula' | 'midnight' | 'lilac';
  onSuccess?: (user: User) => void;
};

type Status = { type: 'idle' | 'loading' | 'success' | 'error'; message?: string };

export function LoginPanel({ theme, onSuccess }: LoginPanelProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>({ type: 'idle' });
  const [mode, setMode] = useState<AuthMode>('login');
  const apiBase = API_BASE;

  const backgroundGlow = useMemo(() => {
    switch (theme) {
      case 'midnight':
        return 'panel-glow midnight';
      case 'lilac':
        return 'panel-glow lilac';
      default:
        return 'panel-glow nebula';
    }
  }, [theme]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus({
      type: 'loading',
      message: mode === 'login' ? 'Входим…' : 'Создаём аккаунт…'
    });

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const response = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Unknown error');
      }

      const payload = await response.json();
      setStatus({
        type: 'success',
        message: mode === 'login' ? 'Добро пожаловать обратно!' : 'Аккаунт создан, настройте профиль.'
      });
      onSuccess?.(payload.user);
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  }

  function handleModeSwitch(next: AuthMode) {
    if (mode === next) return;
    setMode(next);
    setStatus({ type: 'idle' });
  }

  const oauthProviders = useMemo(
    () => [
      {
        id: 'github',
        label: 'Continue with GitHub',
        icon: Github,
        href: `${apiBase}/api/auth/github`,
        accent: 'github' as const
      }
    ],
    [apiBase]
  );

  return (
    <div className="login-panel">
      <div className={backgroundGlow} />
      <motion.h1
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {mode === 'login' ? 'Войдите, чтобы продолжить' : 'Создайте аккаунт Vencord'}
      </motion.h1>
      <p className="muted">
        {mode === 'login'
          ? 'Сообщества, звонки и presence — всё в одном месте. Вернитесь в поток.'
          : 'Сначала зарегистрируйтесь, затем выберите отображаемое имя и основной ник.'}
      </p>

      <motion.form
        className="auth-form"
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <label>
          <span>Email</span>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {mode === 'login' && (
          <div className="form-meta">
            <div className="remember">
              <input type="checkbox" id="remember-me" defaultChecked />
              <label htmlFor="remember-me">Запомнить устройство</label>
            </div>
            <button type="button" className="link">
              Забыли пароль?
            </button>
          </div>
        )}

        <motion.button
          type="submit"
          className="primary"
          whileTap={{ scale: 0.98 }}
          disabled={status.type === 'loading'}
        >
          {status.type === 'loading'
            ? mode === 'login'
              ? 'Входим…'
              : 'Создаем…'
            : mode === 'login'
              ? 'Войти'
              : 'Создать аккаунт'}
        </motion.button>
      </motion.form>

      <div className="form-switch">
        <span>{mode === 'login' ? 'Нет аккаунта?' : 'Уже с нами?'}</span>
        <button
          type="button"
          className="link"
          onClick={() => handleModeSwitch(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'Создать' : 'Войти'}
        </button>
      </div>

      <div className="divider">
        <span />
        <small>или</small>
        <span />
      </div>

      <div className="oauth-buttons">
        {oauthProviders.map((provider) => (
          <motion.a
            key={provider.id}
            href={provider.href}
            className={`oauth ${provider.accent}`}
            target="_self"
            rel="noreferrer"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
          >
            <provider.icon size={18} />
            {provider.label}
          </motion.a>
        ))}
      </div>

      <AnimateStatus status={status} mode={mode} />
    </div>
  );
}

function AnimateStatus({ status, mode }: { status: Status; mode: AuthMode }) {
  return (
    <motion.p
      className={`status ${status.type}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: status.message ? 1 : 0.4, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {status.message ||
        (mode === 'login'
          ? 'Безопасный логин. Двухфакторная аутентификация и вход через OAuth подключаются позже.'
          : 'После регистрации мы попросим придумать отображаемое имя и основной ник, как в Discord.')}
    </motion.p>
  );
}

