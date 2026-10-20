## 2024-05-24 - Provide Context For Disabled Buttons
**Learning:** Adding a `title` to an intentionally disabled button helps users understand why they cannot click the action, while `aria-label`s on repeated buttons (e.g., 'Delete') distinguish identical controls in lists.
**Action:** Identify disabled actions without helper texts and redundant buttons without aria-labels and provide clear hints and accessible names for them.
## 2024-05-24 - Handle Button Disabled States
**Learning:** Consistently using `title` to explain disabled states and `aria-label` to provide context for actions in lists across complex interfaces creates a more predictable and accessible UX.
**Action:** Audit applications for dynamic disabled states and ensure all non-interactive components provide clear contextual reasoning to the user.
