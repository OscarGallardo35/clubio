import React from 'react'

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    className={className}
    ref={ref}
    {...props}
  />
))
Button.displayName = 'Button'
