import React from 'react';
import { cn } from '../../lib/utils';

const variants = {
  default: 'bg-white/10 text-zinc-300 border border-white/10',
  success: 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/20',
  danger: 'bg-red-500/15 text-red-300 border border-red-400/20',
  warning: 'bg-amber-400/15 text-amber-300 border border-amber-300/20',
  info: 'bg-sky-500/15 text-sky-300 border border-sky-400/20',
  running: 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/20',
  stopped: 'bg-zinc-700/40 text-zinc-400 border border-zinc-600/30',
  blocked: 'bg-red-500/15 text-red-300 border border-red-400/20',
};

export const Badge = React.forwardRef(({ className, variant = 'default', ...props }, ref) => (
  <span
    ref={ref}
    className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
      variants[variant] || variants.default,
      className
    )}
    {...props}
  />
));
Badge.displayName = 'Badge';
