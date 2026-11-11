# Privacy Policy - Antigravity Browser Bridge

**Last updated:** November 11, 2026

## 1. Overview
Antigravity Browser Bridge is an open-source browser extension designed to allow users to automate development tasks, inspect web pages, and organize tabs in collaboration with their local AI assistant (Antigravity).

## 2. Data Collection and Usage
- **No Remote Data Collection:** Antigravity Browser Bridge does NOT collect, store, transmit, or sell any personal data, browsing history, cookies, or user credentials to any external servers or third parties.
- **Local Communication Only:** All communication occurs strictly locally on the user's device via a local loopback WebSocket and HTTP server (`127.0.0.1`). No data ever leaves the user's computer.
- **No Analytics / Telemetry:** The extension contains no tracking scripts, advertising trackers, or telemetry services.

## 3. Permissions Justification
- **Host Permissions (`<all_urls>`):** Used solely to allow automated navigation, DOM inspection, and interaction on web platforms explicitly requested by the user (such as Roblox Creator Hub, ChatGPT, or API consoles).
- **Debugger (`chrome.debugger`):** Used strictly to simulate native user clicks, keystrokes, and capture screenshots locally as part of developer automation workflows.
- **Tabs & TabGroups:** Used to manage, open, reload, and organize project-specific tabs into neat tab groups.
- **Storage:** Used only to store connection state and user preferences locally within the browser.
- **Alarms:** Used to maintain local WebSocket keep-alive pings between the extension and the local bridge.

## 4. Contact
For any questions regarding this privacy policy or the extension, please open an issue on GitHub:
https://github.com/hugu641/antigravity-browser-bridge
