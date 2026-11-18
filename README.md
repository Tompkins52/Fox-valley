# Private preview

This repository publishes a login page. Everything behind it is stored in `preview.bin`, which is encrypted and only opens with the password. Three more copies of the login page each open one part by itself: `website/`, `member/` and `staff/`. The member and staff apps can also be put on a phone's home screen.

## Files

- `index.html` is the login page. It downloads `preview.bin`, unlocks it in the browser with the password, and shows what is inside.
- `preview.bin` holds the whole working copy (pages, styles, scripts, fonts, media), encrypted with AES-256-GCM. The key comes from the password through PBKDF2-SHA256 with 600,000 rounds.
- `website/` holds a login page that opens the website by itself. `member/` and `staff/` each hold a login page for one app, its web app manifest and its home screen icons. `tools/pack.mjs` writes the three pages and the two manifests from `index.html`, so do not edit them by hand. The icons are plain marks and the names are plain on purpose: these files are readable by anyone.
- `sw.js` lets an installed app open with no connection. It keeps the login page, the icons and `preview.bin`, which stays encrypted. It only runs for `member/` and `staff/`.
- `tools/` has the scripts that make and open `preview.bin`. They need Node 20 or newer and nothing else.

## Working on it

The working copy lives in `src/`, which is never committed.

```
node tools/unpack.mjs <password>      # writes src/ from preview.bin
node tools/serve.mjs src 8080         # look at the working copy at http://localhost:8080
node tools/pack.mjs <password>        # packs src/ back into preview.bin
node tools/serve.mjs . 8081           # check the login page and the packed copy
```

Packing also stamps `index.html` with the new file's version and rewrites `website/index.html`, `member/index.html`, `staff/index.html` and the two manifests, so commit all of them with `preview.bin`. Do not commit `src/`.

## Notes

- The password is not case sensitive and is never stored in this repository.
- A short password keeps out casual visitors and search engines. It does not stop someone determined to guess it, so treat what is inside as private, not secret.
- A device that kept its login stays logged in when a new version is published, because packing reuses the salt of the file it replaces. A new password asks every device again. So does `node tools/pack.mjs <password> --new-salt`.
- A phone whose browser asks for the desktop site lays pages out 980 wide and shrinks them. The login page notices and opens what is behind it in a frame as wide as the phone, enlarged to fill the screen, so it still gets the phone layout.
- "Keep me logged in on this device" stores the unlock key in the browser. "Lock" inside the preview removes it. On the member and staff pages the box starts ticked, so an installed app asks once.
- Anything readable in this repository must stay free of the customer's name, logo and details. That includes the manifests, the icons and this file.
