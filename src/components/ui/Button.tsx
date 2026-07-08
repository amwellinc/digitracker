import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  children: ReactNode
}

const variants: Record<string, string> = {
  primary: 'bg-violet-600 text-white hover:bg-violet-700',
  secondary: 'border border-gray-200 text-gray-700 hover:bg-gray-50',
  danger: 'text-red-600 border border-red-200 hover:bg-red-50',
  ghost: 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
}

const sizes: Record<string, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

export function Button({ variant = 'primary', size = 'md', className = '', children, ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
