// Shared UI state + action registries (event delegation keeps the app CSP-safe: no inline handlers).
export const S = { user: null, tenant: null, facility: null, summary: null, route: '', rt: 0 };
export const ACT = {}, FORM = {}, INPUT = {}, CHG = {};
export const hooks = { render: () => {}, refreshMe: async () => {} };
export const go = (h) => { if (location.hash === '#' + h) hooks.render(); else location.hash = h; };
export const isAdmin = () => ['super_admin', 'ms_admin', 'facility_admin'].includes(S.user.role);
export const canAuthor = () => ['ms_admin', 'trainer'].includes(S.user.role);
