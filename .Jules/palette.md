## 2024-05-24 - Provide Context For Disabled Buttons
**Learning:** Adding a `title` to an intentionally disabled button helps users understand why they cannot click the action, while `aria-label`s on repeated buttons (e.g., 'Delete') distinguish identical controls in lists.
**Action:** Identify disabled actions without helper texts and redundant buttons without aria-labels and provide clear hints and accessible names for them.
## 2024-11-11 - Add a11y title wrapper for disabled export button
**Learning:** Disabled elements in HTML do not fire pointer events in modern browsers, rendering attributes like `title` ineffective if attached directly to the disabled element. To provide context (e.g., explaining why a button is disabled), a wrapper element like `<span>` should encapsulate the disabled element and host the `title` attribute.
**Action:** When adding explanatory tooltips to intentionally disabled elements (like empty state disabled actions), always enclose the element in a wrapper (such as a `<span>`) and assign the `title` attribute to the wrapper instead of the element directly.
