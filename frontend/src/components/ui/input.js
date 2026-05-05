import React from 'react';
import { cn } from '../../lib/utils';

export const Input = React.forwardRef(({ className, type = 'text', ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'h-10 w-full rounded-md bg-[#0b0d10] border border-white/10 px-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[color:var(--ring)] focus:border-transparent transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed',
      className
    )}
    {...props}
  />
));
Input.displayName = 'Input';
