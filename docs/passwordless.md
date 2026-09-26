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
| `room:abandon` | `roomId` | An authenticated member closes the table for both players, leaving each archive/delete choice pending; returns `roomId, tables`. Repeating the request is idempotent. |
| `room:disposition` | `roomId, disposition` | Stores the caller's choice of `archived` or `deleted` for an abandoned table; returns `roomId, tables`. The other player's choice is unchanged. |
| `game:action` | Existing action plus `expectedRevision` | Rejects actions from an outdated displayed room revision. Plays also retain the existing `expectedPlay` context check. |

The server emits `tables` after membership/game changes, private `state` projections including `revision`, and `identity:revoked` before disconnecting a revoked device. Missing or revoked authentication returns `AUTH_REQUIRED`; malformed/expired/consumed links return `INVALID_LINK`; occupied identity conflicts return `IDENTITY_CONFLICT`; stale game mutations return `STALE_ACTION` (or the existing `STALE_PLAY` for invalid play context).

Shared links use fragments: `/#invite=SECRET&room=ROOM`, `/#device=SECRET`, and `/#recovery=SECRET`. The client captures the fragment in tab storage and removes it from the address bar. Redemption requires a button press. QR generation runs locally. Device-link redemption records a hash receipt on the new device so the same destination credential can safely retry after a lost acknowledgement; a different credential cannot replay it.

The browser stores its credential in `tarokza2.device`. It stores a pending destination credential before making a creation/redemption request. Existing `tarokza2.sessions` and `tarokza2.session` credentials are removed individually only after acknowledged migration. If both seats of one table are present, the UI asks which named seat to claim and retains the unselected credential.

Abandonment is serialized with other room changes. The room is retained with an
`abandonedAt` marker, its saved game and ownership, while its invitation is
invalidated. After persistence, the server emits `room:abandoned {roomId}` to
both players' connected devices and detaches the room's active tabs. Those tabs
return home; a tab that missed the event also returns home when resume fails
with `ROOM_ABANDONED`. Joining, inviting, resuming and playing cannot reopen an
abandoned table. No score or forfeit is invented.

The room's `dispositions` object stores each player's private choice by seat ID.
An absent choice is pending, including for older abandoned records. The table
list includes closed tables with `status: 'abandoned'`, `abandonedAt` and only
the caller's `disposition: 'pending' | 'archived'`; it omits that player's deleted
tables. Active table entries retain their existing shape. Home prompts for each
pending choice when no other dialog or invitation is open; dismissing leaves a
choice button in the archive section and asks again after reload. Players in
another game are prompted when they return home.

Choices synchronize across linked devices and survive restarts. A deletion is
terminal for that player, so a stale archive request cannot restore it. Choices
do not change the other player's list, saved game, shared revision or timestamp.
The server retains the closed record even if both players delete their entries,
preserving saved data and reserving the room code. Invalid choices return
`INVALID_DISPOSITION`; active tables reject choices with `ROOM_ACTIVE`.
Older server releases do not recognize abandonment or private choices and can
expose those tables again; account for that when planning a code rollback.

`identities.json` and all room files belong in the same backup. Registry writes and room writes are separately serialized and atomically replaced. New players are persisted before their rooms; legacy ownership is stored entirely in the registry, avoiding a multi-file claim transaction. See [deployment](deployment.md) for restoration, rollback, and readiness behavior. After upgrading, existing browser tabs need a refresh to load the identity-aware client.
