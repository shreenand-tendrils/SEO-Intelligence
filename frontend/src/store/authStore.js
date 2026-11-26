import { create } from 'zustand';

// Placeholder for authentication. Local development runs single-user; when
// auth is added, tokens should live in httpOnly cookies, not in this store
// or localStorage.
export const useAuthStore = create(() => ({ user: { name: 'Local user' }, isAuthenticated: true }));
