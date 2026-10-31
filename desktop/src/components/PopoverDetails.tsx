import {useRef, useState, type ComponentProps} from 'react';
import {useDismiss} from '../hooks/useDismiss';

/** Transient actions/info, as opposed to persistent disclosure sections. */
export default function PopoverDetails({onToggle, onClick, children, ...props}: ComponentProps<'details'>) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useDismiss(ref, reason => {
    if (!ref.current?.open) return;
    ref.current.open = false;
    if (reason === 'escape') ref.current.querySelector('summary')?.focus();
  }, {enabled: open, onFocusOut: true});
  return <details {...props} ref={ref} data-transient-popover onToggle={event => {
    if (event.target !== event.currentTarget) return;
    const current = event.currentTarget;
    setOpen(current.open);
    if (current.open) {
      for (const other of document.querySelectorAll<HTMLDetailsElement>('details[data-transient-popover][open]')) {
        if (other !== current && !other.contains(current) && !current.contains(other)) other.open = false;
      }
    }
    onToggle?.(event);
  }} onClick={event => {
    onClick?.(event);
    const button = (event.target as Element).closest('button');
    if (!event.defaultPrevented && button && !button.disabled) event.currentTarget.open = false;
  }}>{children}</details>;
}
