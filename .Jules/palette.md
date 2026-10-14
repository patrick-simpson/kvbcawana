## 2024-11-20 - Adding unique accessible names to repeated items
**Learning:** Screen reader users lose context when tabbing through repeated components (like slides) if action buttons (e.g., Duplicate, Delete) only use generic names.
**Action:** When adding actions to a list of identical or similar components, ensure their `aria-label` attributes include an index or unique identifier (e.g., "Delete slide 1") to provide necessary context for screen reader users, and update Vitest assertions to use specific role queries matching those labels.
