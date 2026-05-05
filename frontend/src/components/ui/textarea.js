import React from 'react';
import { cn } from '../../lib/utils';

export const Textarea = React.forwardRef(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'min-h-[80px] w-full rounded-md bg-[#0b0d10] border border-white/10 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[color:var(--ring)] focus:border-transparent transition-colors duration-150 resize-y disabled:opacity-50',
      className
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
