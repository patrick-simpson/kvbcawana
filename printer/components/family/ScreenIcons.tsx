import React from 'react';

/**
 * Extra glyphs for the lobby and Journey sections: plain monochrome icons plus
 * three screen-mock shapes (a starburst sticker and three line doodles), all
 * drawn for this page. No third-party art, no Awana marks. Rendered once,
 * beside the family sprite in Icons.tsx; ids never repeat one that sprite has.
 */
export const ScreenSprite: React.FC = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
    <defs>
      <symbol id="i-hello" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V16.5H4A1.5 1.5 0 0 1 2.5 15V7A1.5 1.5 0 0 1 4 5.5z" /><path d="M7.5 11h.01M12 11h.01M16.5 11h.01" strokeWidth="2.6" /></g></symbol>
      <symbol id="i-queue" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="8" r="2.5" /><circle cx="12" cy="8" r="2.5" /><circle cx="18" cy="8" r="2.5" /><path d="M2.5 18c0-2.5 1.6-4 3.5-4s3.5 1.5 3.5 4M8.5 18c0-2.5 1.6-4 3.5-4s3.5 1.5 3.5 4M14.5 18c0-2.5 1.6-4 3.5-4s3.5 1.5 3.5 4" /></g></symbol>
      <symbol id="i-moon" viewBox="0 0 24 24"><path d="M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" /></symbol>
      <symbol id="i-clock" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></g></symbol>
      <symbol id="i-flag" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 21V3.5" /><path d="M5.5 4.5h11l-2.2 4 2.2 4h-11" /></g></symbol>
      <symbol id="i-whistle" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="8.5" cy="14.5" r="5" /><path d="M12.5 11.5 20.5 7v4.5h-6.2" /><path d="M8.5 14.5h.01" strokeWidth="2.6" /></g></symbol>
      <symbol id="i-bell" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></g></symbol>
      <symbol id="i-wifi" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a5 5 0 0 1 6.4 0" /><path d="M12 19.5h.01" strokeWidth="2.8" /></g></symbol>
      <symbol id="i-talk" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5.5" /><path d="M12 16.5h.01" strokeWidth="2.8" /></g></symbol>
      <symbol id="i-chip" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5" /></g></symbol>
      <symbol id="i-eye" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></g></symbol>
      <symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 2c1 7 3 9 10 10-7 1-9 3-10 10-1-7-3-9-10-10 7-1 9-3 10-10z" fill="currentColor" /></symbol>
      <symbol id="i-burst" viewBox="0 0 100 100"><path d="M50.0,0.0 L55.9,8.9 L64.1,2.0 L67.2,12.3 L77.0,7.9 L77.2,18.6 L87.8,17.3 L84.9,27.6 L95.5,29.2 L89.8,38.3 L99.5,42.9 L91.5,50.0 L99.5,57.1 L89.8,61.7 L95.5,70.8 L84.9,72.4 L87.8,82.7 L77.2,81.4 L77.0,92.1 L67.2,87.7 L64.1,98.0 L55.9,91.1 L50.0,100.0 L44.1,91.1 L35.9,98.0 L32.8,87.7 L23.0,92.1 L22.8,81.4 L12.2,82.7 L15.1,72.4 L4.5,70.8 L10.2,61.7 L0.5,57.1 L8.5,50.0 L0.5,42.9 L10.2,38.3 L4.5,29.2 L15.1,27.6 L12.2,17.3 L22.8,18.6 L23.0,7.9 L32.8,12.3 L35.9,2.0 L44.1,8.9Z" fill="currentColor" /></symbol>
      <symbol id="i-dz-arc" viewBox="0 0 40 20"><path d="M3 17C11 4 29 4 37 15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></symbol>
      <symbol id="i-dz-zig" viewBox="0 0 40 20"><path d="M3 16 11 5l8 11 8-11 10 11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></symbol>
      <symbol id="i-dz-ring" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.2" /></symbol>
      <symbol id="i-resume" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" /><path d="M10.5 9v6l4.5-3z" fill="currentColor" /></g></symbol>
      <symbol id="i-cc" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6M17 10.2a2.3 2.3 0 1 0 0 3.6" /></g></symbol>
      <symbol id="i-ask" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5.5h16v10H9.5L5.5 19v-3.5H4z" /><path d="M10 9.2a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2" /><path d="M12 14h.01" /></g></symbol>
      <symbol id="i-size" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18 7.5 6 12 18M4.6 14h5.8" /><path d="M14 18l3-8 3 8M15 15.5h4" /></g></symbol>
      <symbol id="i-slides" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12.5" rx="1.5" /><path d="M12 16.5V20M8.5 20h7M7 8.5h10M7 12h6" /></g></symbol>
      <symbol id="i-pencil" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></g></symbol>
      <symbol id="i-skip" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6.5v11l7-5.5zM12 6.5v11l7-5.5z" /><path d="M20.5 6v12" /></g></symbol>
      <symbol id="i-book" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.5c-2-1.6-4.7-2-8-1.5v13c3.3-.5 6 0 8 1.5 2-1.5 4.7-2 8-1.5V5c-3.3-.5-6-.1-8 1.5z" /><path d="M12 6.5v13" /></g></symbol>
      <symbol id="i-jump" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h9M4 10h7M4 14h9M4 18h6" /><path d="M15.5 12.5v7l5-3.5z" fill="currentColor" /></g></symbol>
      <symbol id="i-doc" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 15.5h6" /></g></symbol>
      <symbol id="i-list" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8.5h.01M10.5 8.5H17M7 12h.01M10.5 12H17M7 15.5h.01M10.5 15.5H17" /></g></symbol>
      <symbol id="i-save" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5" /><path d="M4 16.5V20h16v-3.5" /></g></symbol>
      <symbol id="i-jd-wifi" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.7 16a5 5 0 0 1 6.6 0" /><path d="M12 19.5h.01" /></g></symbol>
      <symbol id="i-tap" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11l4.2.8a2 2 0 0 1 1.6 2.3l-.9 4.9H10l-3.7-4.3a1.4 1.4 0 0 1 2-2L9 13" /><path d="M5 5.5a5 5 0 0 1 1-2M16 5.5a5 5 0 0 0-1-2" /></g></symbol>
      <symbol id="i-sun" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></g></symbol>
      <symbol id="i-jd-chip" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12" rx="1.5" /><path d="M9.5 9.5h5v5h-5zM9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" /></g></symbol>
    </defs>
  </svg>
);
