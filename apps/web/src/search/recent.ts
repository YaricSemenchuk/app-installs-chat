// Недавние запросы поиска — в браузере, у каждого свои.
const KEY = "teamchat.recentSearches";
const MAX = 6;

export function recentSearches(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(q: string) {
  const query = q.trim();
  if (!query) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([query, ...recentSearches().filter((x) => x !== query)].slice(0, MAX)));
  } catch {
    // нет доступа к хранилищу — без памяти
  }
}
