import type { ComponentProps } from 'react';
import { Link, NavLink } from 'react-router';
import type { LinkProps, NavLinkProps } from 'react-router';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';
import './ui.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon';

function buttonClass(variant: ButtonVariant, className?: string) {
  return `ui-button ui-button--${variant}${className ? ` ${className}` : ''}`;
}

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant }) {
  return <button {...props} type={type} className={buttonClass(variant, className)} />;
}

export function ButtonLink({
  variant = 'secondary',
  className,
  ...props
}: LinkProps & { variant?: Exclude<ButtonVariant, 'icon'> }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}

export function SidebarLink({
  icon,
  children,
  className,
  ...props
}: Omit<NavLinkProps, 'className' | 'children'> & {
  icon: IconName;
  children: string;
  className?: string;
}) {
  return (
    <NavLink
      {...props}
      className={({ isActive }) =>
        `nav-item${isActive ? ' active' : ''}${className ? ` ${className}` : ''}`
      }
    >
      <Icon name={icon} />
      <span>{children}</span>
      <span className="nav-active-mark" aria-hidden="true" />
    </NavLink>
  );
}

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input {...props} className={`ui-control ${className}`} />;
}

export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return <select {...props} className={`ui-control ${className}`} />;
}

export function Textarea({ className = '', ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={`ui-control ${className}`} />;
}

export function Field({ className = '', ...props }: ComponentProps<'label'>) {
  return <label {...props} className={`ui-field ${className}`} />;
}

export function Panel({ className = '', ...props }: ComponentProps<'section'>) {
  return <section {...props} className={`ui-panel ${className}`} />;
}
