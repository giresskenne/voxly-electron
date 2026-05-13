const pendingDeepLinks: string[] = [];

export function queueDeepLink(url: string): void {
  pendingDeepLinks.push(url);
}

export function consumePendingDeepLinks(): string[] {
  if (pendingDeepLinks.length === 0) return [];
  return pendingDeepLinks.splice(0, pendingDeepLinks.length);
}