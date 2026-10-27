# Sync

EquipWorthy is local-first: every device keeps its own full copy. Sync is optional and stores an encrypted copy of each profile in a private GitHub Gist on your own account.

Code: `web/src/lib/sync.ts` and `syncManager.ts` (web), and `ios/EquipWorthy.swiftpm/Sources/EquipWorthyKit/Sync.swift` and `Sources/App/SyncManager.swift` (iOS). Both implement the same format and rules, and tests check that web-encrypted data decrypts on iOS.

## Storage
- One gist named **"EquipWorthy sync (encrypted)"**, created automatically and private.
- One file per profile: `equipworthy-<profileId>.json`, containing an envelope:

```json
{ "app": "equipworthy", "v": 1, "profileId": "…", "name": "My Collection", "updatedAt": "ISO",
  "kdf": "PBKDF2-SHA256", "iter": 210000, "salt": "base64", "iv": "base64", "data": "base64" }
```

- `data` is the profile JSON (without the card cache) encrypted with AES-256-GCM. The key comes from PBKDF2-SHA256 over your passphrase with 210,000 iterations and a random salt. The 16-byte tag is appended to the ciphertext.
- The profile name and update time are left in plain text, so a new device can show which profiles exist before you download one.

## When it syncs
On app start, 8 s after each save, when the app or tab returns to the foreground, every 5 minutes, and when you tap the sync button.

## Merge rules (three-way)
Each device remembers the last version it synced (the *base*). On sync:

1. Download and decrypt the remote copy.
2. For lists (collection, wishlist, decks, watchlist, alerts, trades, batch queue, binders, forecast log), merge item by item using the id:
   - changed on one side only → that side's version
   - changed on both sides → the copy from the profile edited most recently
   - added on either side → kept
   - deleted on one side and unchanged on the other → deleted
3. Settings, the profile name and the life-tracker game: whichever side changed; if both changed, the most recently edited wins.
4. Price history and portfolio history: union of daily points.
5. If the merged result differs from the remote copy, encrypt and upload it. If it differs from the local copy, apply it locally without bumping the edit time, so devices don't bounce changes back and forth.

Card images and prices (the card cache) are not synced; each device downloads them from Scryfall.

## Security notes
- The GitHub token only needs the `gist` scope. On iOS it's stored in the Keychain; on the web in the browser's local storage on that device.
- Without the passphrase the gist contents are unreadable. If the passphrase is lost, synced data can't be recovered, but every device still has its local copy and you can set up sync again with a new passphrase.
- Turning sync off on a device keeps its local data.
