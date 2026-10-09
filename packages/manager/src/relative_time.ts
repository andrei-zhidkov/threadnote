import {useEffect, useState} from 'react';

export function useRelativeTimeNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function formatRelativeAge(timestamp: string | undefined, now: number): string | undefined {
  if (!timestamp) return undefined;
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return undefined;
  const seconds = Math.max(0, Math.floor((now - time) / 1_000));
  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3_600);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(seconds / 86_400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
