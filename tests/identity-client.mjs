// Explicit protocol adapter used by the existing gameplay/hosting fixtures.
// Session.token is a device credential held by the test client, never returned by room APIs.
import { randomBytes } from 'node:crypto';
const invitations = new Map();
export function identityRequests(socket, getState) {
  let credential;
  const raw = (event, payload) => socket.timeout(5000).emitWithAck(event, payload);
  return async (event, payload = {}) => {
    if ((event === 'room:create' || (event === 'room:join' && invitations.has(payload.roomId?.toUpperCase()))) && payload.name?.trim() && !credential) {
      credential = randomBytes(32).toString('base64url');
      const result = await raw('identity:create', { name: payload.name, credential });
      if (!result.ok) { credential = null; return result; }
    }
    if (event === 'room:resume' && payload.token) {
      const result = await raw('identity:resume', { credential: payload.token });
      if (!result.ok) return result;
      credential = payload.token;
    }
    if (event === 'room:join') payload = { ...payload, invitation: payload.invitation ?? invitations.get(payload.roomId?.toUpperCase()) };
    if (event === 'game:action') payload = { expectedRevision: getState()?.revision, ...payload };
    const result = await raw(event, payload);
    if (event === 'room:create' && result.ok) invitations.set(result.roomId, result.invitation);
    return result.ok && ['room:create', 'room:join', 'room:resume'].includes(event) ? { ...result, token: credential } : result;
  };
}
