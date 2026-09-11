export const retryDelay = attempt => Math.min(5, 2 ** Math.min(Math.max(0, attempt - 1), 3)) * 60000;
