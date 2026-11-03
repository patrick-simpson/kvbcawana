## 2024-05-24 - Provide Context For Disabled Buttons
**Learning:** Adding a `title` to an intentionally disabled button helps users understand why they cannot click the action, while `aria-label`s on repeated buttons (e.g., 'Delete') distinguish identical controls in lists.
**Action:** Identify disabled actions without helper texts and redundant buttons without aria-labels and provide clear hints and accessible names for them.
## 2026-11-03 - Added missing title to disabled buttons
**Learning:** Some disabled buttons didn't have `title` tags in the application which provides an explanation to the user as to why it is disabled.
**Action:** Always ensure that disabled buttons have a `title` attribute to explain why they are disabled.
