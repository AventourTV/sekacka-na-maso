import React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[10px] font-medium text-sm transition-colors transition-transform duration-150 focus:outline-none focus:ring-2 focus:ring-[color:var(--ring)] focus:ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed select-none',
  {
    variants: {
      variant: {
        primary: 'bg-blue-500 hover:bg-blue-600 text-white',
        secondary: 'bg-white/5 hover:bg-white/10 text-zinc-200 border border-white/10',
        ghost: 'bg-transparent hover:bg-white/5 text-zinc-300',
        danger: 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-400/20',
        success: 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-400/20',
        warning: 'bg-amber-400/15 hover:bg-amber-400/25 text-amber-300 border border-amber-300/20',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export const Button = React.forwardRef(({ className, variant, size, children, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
    {children}
  </button>
));
Button.displayName = 'Button';
