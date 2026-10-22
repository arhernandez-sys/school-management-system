export const __setRole = (r) => { globalThis.__ROLE = r; };
export const useAuth = () => ({ user: globalThis.__ROLE ? { role: globalThis.__ROLE } : null });
