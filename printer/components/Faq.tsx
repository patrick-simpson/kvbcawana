import React from 'react';
import { Ico } from './home/Icons';

const QA: { q: string; a: React.ReactNode }[] = [
  {
    q: 'What do I need to buy?',
    a: 'Just a thermal label printer (any brand Windows can print to) and 4×2 inch direct-thermal labels. The software is free, with its source on GitHub, and there are no subscriptions.',
  },
  {
    q: 'Can it print the same child twice by accident?',
    a: 'No. The print server holds back a repeat print of the same child within a 45-second window, so retries, double-taps and overlapping detection paths produce exactly one label. Deliberate reprints from the widget or the settings page always work.',
  },
  {
    q: 'What happens if the Wi-Fi goes down mid-event?',
    a: 'Labels keep printing. The roster is kept on the laptop and in the extension, prints wait in line while the server is briefly out of reach, and the widget search works from the saved roster, so you can keep printing labels and finish the TwoTimTwo check-ins when the connection returns. Phones and the settings page need the internet, so they wait until it is back; the check-in desk does not.',
  },
  {
    q: 'How do updates work?',
    a: 'The Windows app checks for new versions and installs them itself, restarting within seconds. The Chrome extension’s files are updated along with it; restart Chrome to load them, and the widget tells you when that’s owed.',
  },
  {
    q: 'Where does the allergy and birthday data come from, and where does it go?',
    a: 'From your own TwoTimTwo roster: the extension syncs it to the print server on your laptop using your logged-in session. Allergies, birthdates and photo answers stay on that computer. If you connect lobby screens, they receive only what they need to greet a child by first name, sealed once you set a display key.',
  },
  {
    q: 'Is this an official Awana or TwoTimTwo product?',
    a: 'No. KVBC Awana is an independent project made at Kennebec Valley Baptist Church, a member church that uses the Awana marks to describe what it works alongside. It is not affiliated with or endorsed by Awana Clubs International or TwoTimTwo.com; it simply works alongside TwoTimTwo’s check-in page.',
  },
  {
    q: 'Something isn’t printing. Help?',
    a: <>Click <strong>Help — Not Working?</strong> in the widget for automatic diagnostics, or open <code className="kv-code">awana.kvbchurch.org/settings</code> in Chrome on the laptop for a health check, plain-language warnings, diagnostics and a test label.</>,
  },
];

export const Faq: React.FC = () => (
  <section id="faq" className="kv-faq" aria-labelledby="faq-title">
    <div className="kv-wrap kv-faq__inner">
      <div className="kv-head">
        <p className="kv-tabkicker">Questions</p>
        <h2 className="kv-h2" id="faq-title">Questions volunteers ask</h2>
      </div>
      <div className="kv-faq__list">
        {QA.map(item => (
          <details key={item.q} className="kv-faq__item">
            <summary className="kv-faq__q">
              <span>{item.q}</span>
              <span className="kv-faq__chev" aria-hidden="true"><Ico name="chev" /></span>
            </summary>
            <p className="kv-faq__a">{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  </section>
);
