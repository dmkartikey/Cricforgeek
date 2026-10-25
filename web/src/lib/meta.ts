import { useEffect } from 'react';

// Keep the tab title and canonical link in step with client-side navigation.
export function usePageMeta(title: string | null | undefined, home = false) {
  useEffect(() => {
    if (!title) return;
    document.title = home ? title : `${title} · cricforgeek`;
    const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (link) link.href = location.origin + (location.pathname === '/' ? '/' : location.pathname.replace(/\/$/, ''));
  }, [title, home]);
}
