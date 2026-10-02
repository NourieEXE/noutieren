import { useEffect, useState } from 'react';
import type { ThemePreference } from '../types';
import { RELEASES } from '../releaseNotes';
import { loadPreferences } from '../services/preferences';
import { getBrowserApi } from '../services/webext';
import { useTheme } from '../hooks/useTheme';

function formatReleaseDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Every version's notes, newest first. Opened from Settings → What's new. */
export function WhatsNewPage() {
  const [theme, setTheme] = useState<ThemePreference>('system');
  useTheme(theme);

  useEffect(() => {
    document.title = "What's new · Noutieren";
    void loadPreferences().then((preferences) => setTheme(preferences.theme));
  }, []);

  const installed = getBrowserApi()?.runtime.getManifest().version ?? RELEASES[0].version;

  return (
    <div className="whats-new">
      <main className="whats-new__column">
        <a className="whats-new__back" href="index.html?view=page">
          Back to notes
        </a>
        <h1 className="whats-new__title">What's new</h1>
        <p className="whats-new__lead">You are on version {installed}.</p>

        {RELEASES.map((release) => (
          <section
            key={release.version}
            className="release"
            aria-labelledby={`v${release.version}`}
          >
            <h2 className="release__heading" id={`v${release.version}`}>
              {release.version}
              <time className="release__date" dateTime={release.date}>
                {formatReleaseDate(release.date)}
              </time>
            </h2>
            <ul className="release__notes">
              {release.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        ))}

        <p className="whats-new__footer">
          The developer changelog is in the{' '}
          <a href="https://github.com/NourieEXE/noutieren/blob/main/CHANGELOG.md">repository</a>.
        </p>
      </main>
    </div>
  );
}
