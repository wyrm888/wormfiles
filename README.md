# WormFiles

A customizable file explorer for Windows 11, with Worm, a built-in privacy browser.

**Just want to use it?** Download `WormFiles-Setup-<version>.exe` from the latest release ([Releases](../../releases/latest)) and run it. It updates itself after that. Windows may say "Windows protected your PC" because the app isn't code-signed. Click **More info → Run anyway**.

## Install, update and share

Double-click **Install WormFiles.bat**. Every time you run it, it:

1. Installs Node.js with winget if it's missing (first time only; if it asks, run the file again).
2. Builds the installer, `dist\WormFiles-Setup-<version>.exe`, after deleting old ones.
3. Copies it to **OneDrive\WormFiles\WormFiles Setup.exe**, replacing the previous one.
4. Offers to install it on this PC.

To share with friends, right-click `WormFiles Setup.exe` in OneDrive\WormFiles, choose **Share**, and copy the link. You only do this once. The file name never changes, so the same link always downloads the newest version.

Windows SmartScreen may warn your friends because the app isn't code-signed. They should click **More info → Run anyway**.

## What it does

- **Tabs.** Ctrl+T opens a tab and Ctrl+W closes one. You can drag tabs to reorder them, and middle-click a folder to open it in a new tab. Your tabs reopen the next time you start the app.
- **Category tabs.** All · Folders · Images · Videos · Music · Documents · Archives · Code · Apps · Other. Turn on **Include subfolders** to collect, say, every image inside a folder and all of its subfolders.
- **Search.** Typing filters the current folder instantly. Press **Enter** to search every subfolder too. Supported filters: `ext:png,jpg` · `type:video` · `size:>500mb` · `modified:<7d` · `kind:folder` · wildcards like `IMG_*.jpg` · `-word` to exclude a word · `"exact phrase"`.
- **Auto sorting.** Each folder remembers its own sort order. Rules sort folders by name pattern, so Downloads, Screenshots, Pictures and Videos show newest files first. You can edit the rules in Customize → Auto-sort. You can also group items by type, date or size.
- **Tidy up.** Right-click an empty spot and choose "Tidy up this folder". It sorts loose files into Images/Videos/Music/Documents/… folders, and you can undo it.
- **Theming.** 14 themes, including Crimson (the default), Hot Pink and Bubblegum, plus a custom accent color, background image with blur and visibility controls, panel transparency, the Windows 11 Mica effect, text size, corner roundness, density, icon size, and your own custom CSS.
- **Preview pane** (Alt+P). Shows images with their dimensions, plays video and audio, previews text and code, and calculates folder sizes.
- Grid and list views, Ctrl+scroll to change icon size, drag-select, drag and drop (to and from other apps; hold Ctrl to copy), rename (F2), Recycle Bin delete, pinned folders, drive space bars, Open terminal here, Properties, Open with…

## Spacebar preview, zips, space map, split view

- **Spacebar preview:** select a file and press **Space** to see it full-size. It works for photos, videos, music, PDFs, text and code, and for the contents of a folder or zip. Use the arrow keys to move to the next or previous file, **Enter** to open it, and Space or Esc to close.
- **Zips open like folders:** double-click a .zip, .7z or .tar to look inside. Copy files out with Ctrl+C / Ctrl+V or by dragging them, or right-click a zip and choose **Extract to "name\"** or **Extract here**. Files inside are read-only. For .rar files, install the free [7-Zip](https://7-zip.org). To open zips with your usual app instead, turn this off in Customize → Behavior.
- **Disk space map:** right-click an empty spot (or a folder) and choose **Disk space map**, or click the map button on a drive in This PC. Bigger blocks use more space. Click a folder to look inside, double-click a file to find it, and right-click for more options.
- **Split view:** press **Ctrl+\\** or click the split button to show two folders side by side. Click a side to use it, and drag files between them. You can also right-click a tab and choose **Show side by side with this tab**.

## Mail button

The envelope at the left of the tab bar opens Proton Mail inside Worm. It shows how many unread emails you have, and Proton can send new-mail notifications. Click it again, or press Ctrl+W, to go back. You can change the address or turn the button off in Customize → Worm browser.

## Worm — the built-in privacy browser

Click the globe next to **+** (or press **Ctrl+Shift+T**) to open a Worm tab. Worm tabs sit alongside folder tabs.

- **Blocks ads and trackers** using the EasyList and EasyPrivacy filter lists (the same ones uBlock Origin uses). The shield button shows how many it blocked on the current page. **YouTube** gets its own shield: it removes video ads before the player loads them, skips any that slip through, hides sponsored results, and removes the "ad blockers aren't allowed" popup. YouTube changes how it serves ads every so often, so if ads come back, this is the part that needs updating.
- **Privacy defaults:** blocks third-party cookies, sends Do Not Track and Global Privacy Control, hides your local IP from WebRTC, and identifies itself as plain Chrome. It also denies location and notification requests automatically and asks before any site uses your camera or microphone.
- **DuckDuckGo** is the default search engine. Startpage, Brave Search, Mojeek, Ecosia, Bing and Google are also available.
- **Downloads go into the folder you were last viewing.** A toast offers "Show in folder", which opens that folder as a tab with the file selected. You can change this in Customize → Worm browser.
- Includes bookmarks (Ctrl+D), a new tab page with your bookmarks and most visited sites, address-bar suggestions, find on page (Ctrl+F), zoom, print, save page, dev tools (F12), and a built-in PDF viewer.
- Type a web address into a folder tab's address bar to open it in Worm. Type a folder path into a Worm tab to open that folder. Right-click an HTML, PDF, image or video file and choose **Open in Worm**.
- **Speed:** Worm starts connecting to a site when you hover over a link or type its address. It looks up sites through encrypted DNS (Cloudflare 1.1.1.1 by default, also Quad9 or Google), uses GPU boost for smoother scrolling and video, and keeps a 512 MB cache. You can change all of these in Customize → Worm browser → Speed.
- Optional: forget cookies and site data every time WormFiles closes. Clear browsing data whenever you want from the shield or ⋯ menu.

Worm runs on Chromium, not Firefox, so it's not as hardened against fingerprinting as LibreWolf and can't run Firefox extensions. It gets security updates when WormFiles's Electron version is updated, not on its own.

All shortcuts are listed in Customize (Ctrl+,) → Shortcuts.

Settings are saved in `%APPDATA%\wormfiles\settings.json`.

## Publishing updates (for the owner)

Double-click **Publish Update.bat**. The first time, it installs Git and the GitHub CLI, asks you to sign in to GitHub, and creates the public `wormfiles` repository. Each time after that, it:

1. Uploads the code.
2. Builds the installer.
3. Posts it as a new release.
4. Copies the link to share.

Installed copies check for new releases every few hours, download them in the background, and offer to restart. Each release needs a new version number; the script offers to bump it if you forget.

## Make WormFiles your main file explorer and Worm your browser

Open Customize (Ctrl+,) → **Behavior** → **Windows**:

- **Open folders in WormFiles:** folders you open from the desktop, with Win+E, from shortcuts, or from other apps open as WormFiles tabs instead of File Explorer windows. If WormFiles is already open, they open as a new tab in that window. Turn it off to go back. Uninstalling WormFiles undoes it automatically.
- **Make Worm my default browser:** Windows opens its Default apps page on Worm. Click **Set default**. Links from Discord, email and other apps then open as Worm tabs, and so do .html and .pdf files.

File Explorer itself isn't removed. Windows still uses it for the desktop and taskbar, the File Explorer icon pinned to the taskbar still opens it, and "Show in Windows Explorer" always opens the real one.

## Notes

- Delete always goes to the Recycle Bin. WormFiles never permanently deletes files.
- Copy and paste work inside WormFiles. To move files to or from Windows Explorer, drag and drop them.

## Project layout

```
src/main.js        file system, search, thumbnails, window
src/browser.js     Worm (built-in browser): tabs, ad blocking, privacy, downloads
src/web-preload.js Worm page shield (YouTube ad removal)
src/integration.js Windows integration (open folders, default browser)
src/archive.js     browse zips with 7-Zip
src/spacemap.js    disk space map scanner
src/renderer/extras.js  mail button, spacebar preview, space map, split view
build/installer.nsh cleans that up on uninstall
src/preload.js     bridge between the window and main.js
src/query.js       search syntax parser
src/categories.js  which extensions count as images, videos, ...
src/renderer/      the interface (HTML/CSS/JS, themes, icons; web.js = browser UI)
build/icon.ico     app icon
```
