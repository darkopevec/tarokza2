# Players, invitations, and devices

A player is a persistent identity with a display name. A device is a browser profile with its own opaque credential. Room-local seat IDs and saved game history do not change when a player links another device.

All operations below use Socket.IO acknowledgements: `{ok:true, ...result}` or `{ok:false, error, code?}`. Authentication and credential operations share the existing per-IP authentication limiter. Authenticate each new connection before accessing tables. Credentials are 32 random bytes encoded as unpadded base64url; only SHA-256 hashes are persisted.

| Event | Input | Result / behavior |
| --- | --- | --- |
| `identity:create` | `name, credential` | Creates a player and first device; returns `user, tables`. Retrying the same credential is idempotent. |
| `identity:resume` | `credential` | Authenticates the socket; returns `user, tables`. |
| `tables:list` | — | Returns the authenticated player's `tables`, most recently updated first. |
| `devices:list` | — | Returns `devices` with ID, name, creation time, and current-device marker. |
| `devices:rename` | `id, name` | Renames an owned device. |
| `devices:revoke` | `id` | Removes another owned device and disconnects all its sockets. |
| `devices:link` | — | Returns a new `token, expiresAt`; replaces earlier pending device links. |
| `recovery:create` | — | Returns a new `token`; invalidates the previous recovery link. |
| `identity:redeem` | `kind, token, credential, existingCredential?` | `kind` is `device` or `recovery`. Registers the destination credential and returns `user, tables, alreadyConnected`. A different existing identity is rejected. |
| `identity:legacy` | `roomId, token` | Validates an old seat token and returns its name and player ID for seat selection. |
| `identity:claim` | `roomId, token` | Associates a legacy seat with the authenticated identity, idempotently. |
| `room:create` | — | Creates a table for the authenticated player; returns `roomId, playerId, invitation`. |
| `room:invite` | `roomId` | Replaces an owned waiting table's invitation; returns `roomId, invitation`. |
| `room:join` | `roomId, invitation` | Atomically claims the vacant seat and consumes the invitation, or resumes the caller's existing seat. |
| `room:resume` | `roomId` | Restores an owned seat without any per-room credential. |
| `room:leave` | — | Detaches this tab, retaining identity and membership. |
| `game:action` | Existing action plus `expectedRevision` | Rejects actions from an outdated displayed room revision. Plays also retain the existing `expectedPlay` context check. |

The server emits `tables` after membership/game changes, private `state` projections including `revision`, and `identity:revoked` before disconnecting a revoked device. Missing or revoked authentication returns `AUTH_REQUIRED`; malformed/expired/consumed links return `INVALID_LINK`; occupied identity conflicts return `IDENTITY_CONFLICT`; stale game mutations return `STALE_ACTION` (or the existing `STALE_PLAY` for invalid play context).

Shared links use fragments: `/#invite=SECRET&room=ROOM`, `/#device=SECRET`, and `/#recovery=SECRET`. The client captures the fragment in tab storage and removes it from the address bar. Redemption requires a button press. QR generation runs locally. Device-link redemption records a hash receipt on the new device so the same destination credential can safely retry after a lost acknowledgement; a different credential cannot replay it.

The browser stores its credential in `tarokza2.device`. It stores a pending destination credential before making a creation/redemption request. Existing `tarokza2.sessions` and `tarokza2.session` credentials are removed individually only after acknowledged migration. If both seats of one table are present, the UI asks which named seat to claim and retains the unselected credential.

`identities.json` and all room files belong in the same backup. Registry writes and room writes are separately serialized and atomically replaced. New players are persisted before their rooms; legacy ownership is stored entirely in the registry, avoiding a multi-file claim transaction. See [deployment](deployment.md) for restoration, rollback, and readiness behavior. After upgrading, existing browser tabs need a refresh to load the identity-aware client.
