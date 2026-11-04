import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './primitives.css';

export { Select } from './Select';
export type { SelectOption } from './Select';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  block?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    'btn',
    `btn--${variant}`,
    size === 'sm' ? 'btn--sm' : '',
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  return (
    <div className="toggle-row">
      <div className="toggle-row__text">
        <span className="toggle-row__title">{label}</span>
        {description && <span className="toggle-row__desc">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className="toggle"
        data-on={checked}
        onClick={() => onChange(!checked)}
        style={disabled ? { opacity: 0.4 } : undefined}
      >
        <span className="toggle__knob" />
      </button>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className="segmented__item"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

export function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section__head">
        <h3 className="section__title">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export type DotState = 'idle' | 'ok' | 'warn' | 'danger' | 'busy';
export function Dot({ state }: { state: DotState }) {
  const map: Record<DotState, string> = {
    idle: 'dot',
    ok: 'dot dot--ok',
    warn: 'dot dot--warn',
    danger: 'dot dot--danger',
    busy: 'dot dot--busy',
  };
  return <span className={map[state]} aria-hidden="true" />;
}
