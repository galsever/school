import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** A team's main channel (the one a class opens with). */
export function mainChannel<T extends { original: string }>(channels: T[]): T | undefined {
  return channels.find((c) => c.original === 'General' || c.original === 'Allgemein') ?? channels[0]
}
