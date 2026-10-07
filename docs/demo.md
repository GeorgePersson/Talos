# Talos walkthrough

![Captioned Talos walkthrough](media/talos-demo.gif)

[Download the GIF](media/talos-demo.gif) or [download the MP4](media/talos-demo.mp4)
for a post or presentation. Both are 35 seconds, 1000 × 730 pixels and silent.
The GIF loops; the MP4 uses H.264. The captures show the actual Windows app,
with short pauses and captions added for readability.

## What the walkthrough shows

| Time | Action |
| --- | --- |
| 0–3s | A fresh workspace starts with Account 1, Account 2 and Account 3. |
| 3–6s | Account 1 signs into the local demo as `account1@example.test`. |
| 6–9s | Account 2 opens the same site's origin with empty session data. |
| 9–12s | Account 2 signs in as `account2@example.test`. |
| 12–15s | Switching back shows Account 1 still signed in. |
| 15–18s | An additional demo inbox tab shares Account 1's cookies and storage. |
| 18–22s | The locator picker returns a Playwright locator for the Sign out button. |
| 22–24s | The API tester sends a request using the selected group's session. |
| 24–28s | The response shows Account 1's cookie was sent. |
| 28–31s | The Playwright panel explains how to enable a live connection. |
| 31–35s | The grouped workspace and project link finish the walkthrough. |

All identities are fictional. The local fixture simulates login and an inbox;
it does not demonstrate Gmail or Outlook authentication. Real inboxes are
ordinary webmail tabs you sign into yourself. Tabs in a group share cookies,
local storage, IndexedDB, cache and service workers. Session storage remains
specific to each tab, as it does in Chromium.

Groups can be renamed, given colours and expanded with extra tabs. The default
account numbers are labels, not permissions or roles. Updating Talos preserves
names in existing saved workspaces.

## Try it yourself

1. Start Talos. For the local fixture, run `npm ci`, then `npm run demo` in the
   source checkout. Start the app with `npm start` in another terminal.
2. Open `http://127.0.0.1:4173` in Account 1 and sign in with a pretend identity.
3. Open the same address in Account 2. Its session starts clean; sign in with a
   different pretend identity. Switch back to Account 1 to compare.
4. Use the tab row's **+** in Account 1 and open
   `http://127.0.0.1:4173/inbox`. The group keeps its login across both tabs.
5. Open **QA tools → Locator picker → Pick an element**, then select **Sign out**.
   Review the generated locator before using it in a test.
6. Select **API tester**, enter `http://127.0.0.1:4173/api/echo`, leave
   **Use this group's cookies and session** enabled and choose **Send request**.
7. Use the **Playwright** panel and [adapter guide](../integrations/playwright/README.md)
   for live automation. Automation is opt-in and was off during this recording.

The recording uses a temporary profile and local fixture with an automatically
assigned port. Separate paths on the same origin distinguish the account pages
for the capture harness; they still exercise the same site's browser storage.
No Docker, production credentials or external inbox connection is needed.
