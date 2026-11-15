# Private preview

This repository publishes one login page. Everything behind it is stored in `preview.bin`, which is encrypted and only opens with the password.

## Files

- `index.html` is the login page. It downloads `preview.bin`, unlocks it in the browser with the password, and shows what is inside.
- `preview.bin` holds the whole working copy (pages, styles, scripts, fonts, media), encrypted with AES-256-GCM. The key comes from the password through PBKDF2-SHA256 with 600,000 rounds.
- `tools/` has the scripts that make and open `preview.bin`. They need Node 20 or newer and nothing else.

## Working on it

The working copy lives in `src/`, which is never committed.

```
node tools/unpack.mjs <password>      # writes src/ from preview.bin
node tools/serve.mjs src 8080         # look at the working copy at http://localhost:8080
node tools/pack.mjs <password>        # packs src/ back into preview.bin
node tools/serve.mjs . 8081           # check the login page and the packed copy
```

Commit `preview.bin` after packing. Do not commit `src/`.

## Notes

- The password is not case sensitive and is never stored in this repository.
- A short password keeps out casual visitors and search engines. It does not stop someone determined to guess it, so treat what is inside as private, not secret.
- "Keep me logged in on this device" stores the unlock key in the browser. "Lock" inside the preview removes it.
