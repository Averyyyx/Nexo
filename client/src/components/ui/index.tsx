import { forwardRef, useEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { ChevronDown, X } from 'lucide-react';

type FieldProps = { label: string; hint?: string; error?: string; children: ReactNode; className?: string };
export function Field({ label, hint, error, children, className = '' }: FieldProps) {
  return <label className={`nexo-field ${className}`}>
    <span>{label}</span>
    <div className="nexo-field-control">{children}</div>
    {(error || hint) && <small className={error ? 'nexo-field-error' : 'nexo-field-hint'}>{error || hint}</small>}
  </label>;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input {...props} ref={ref} className={`nexo-input ${props.className || ''}`} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(props, ref) {
  return <textarea {...props} ref={ref} className={`nexo-textarea ${props.className || ''}`} />;
});

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className="nexo-select-wrap"><select {...props} className={`nexo-select ${props.className || ''}`} /> <ChevronDown size={15} aria-hidden="true" /></span>;
}

type SwitchProps = { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean };
export function Switch({ checked, onChange, label, disabled = false }: SwitchProps) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
    className={`nexo-switch ${checked ? 'checked' : ''}`} onClick={() => onChange(!checked)}><span /></button>;
}

type SliderProps = { value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void; label: string; valueLabel?: string; disabled?: boolean };
export function Slider({ value, min = 0, max = 100, step = 1, onChange, label, valueLabel, disabled = false }: SliderProps) {
  return <label className="nexo-slider"><span>{label}</span><input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} /><output>{valueLabel ?? value}</output></label>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg' };
export function Button({ variant = 'secondary', size = 'md', className = '', ...props }: ButtonProps) {
  return <button {...props} className={`nexo-ui-button ${variant} ${size} ${className}`} />;
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string };
export function IconButton({ label, shortcut, children, className = '', ...props }: IconButtonProps) {
  return <button {...props} type={props.type || 'button'} aria-label={label} data-tooltip={label} data-shortcut={shortcut || undefined}
    className={`nexo-icon-button ${className}`}>{children}</button>;
}

export function Tooltip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactNode }) {
  return <span className="nexo-tooltip" data-tooltip={label} data-shortcut={shortcut || undefined}>{children}</span>;
}

type ModalProps = { title: string; onClose: () => void; children: ReactNode; width?: 'form' | 'wide'; footer?: ReactNode };
export function Modal({ title, onClose, children, width = 'form', footer }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = () => panel?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') || [];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(focusable());
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, [onClose]);
  return <div className="nexo-ui-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panelRef} className={`nexo-ui-modal ${width}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><IconButton label="Закрыть" onClick={onClose}><X size={17} /></IconButton></header>
      <div className="nexo-ui-modal-content">{children}</div>
      {footer && <footer>{footer}</footer>}
    </div>
  </div>;
}
