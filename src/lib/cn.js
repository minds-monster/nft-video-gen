import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard Tailwind class combiner: clsx handles conditionals, twMerge resolves
// conflicting utilities so a caller-passed `className` always wins.
export const cn = (...inputs) => twMerge(clsx(inputs));
