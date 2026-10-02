/**
 * What changed in each version, for the "What's new" page. Plain sentences
 * for people using Noutieren; CHANGELOG.md is the developer version.
 */

export interface Release {
  version: string;
  /** `YYYY-MM-DD`. */
  date: string;
  notes: readonly string[];
}

/** Newest first. */
export const RELEASES: readonly Release[] = [
  {
    version: '1.4.0',
    date: '2026-09-26',
    notes: [
      'Notes can have reminders. Pick a time from the note’s menu, under Remind me, and you get a notification when it is due, even with Noutieren closed. Clicking the notification opens the note.',
      'Deleted notes are kept for 30 days in Recently deleted, in the settings menu, so you can get them back. The same goes for the notes in a tab you delete.',
      'Moving a tab or note past one that a pin was hiding looked like it did nothing. It moves properly now.',
      'Fixed a pin change getting lost on Chrome when the popup closed at the same moment.',
      'Chrome no longer shows messages that talk about Firefox or a sidebar.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-08-04',
    notes: [
      'Pin to URL: a tab or a single note can be set to show only while a certain page is open. Handy for notes that only matter on one site.',
      'When a pin is hiding something, a button in the tab strip says how many, and shows them again with one click.',
      'Noutieren is on the Chrome Web Store too, as a popup from the toolbar.',
      'Pins need permission to see the address of the tab you are on. Noutieren only asks once you turn them on, and the address stays on your device.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-07-25',
    notes: [
      'Noutieren asks the browser not to clear its storage when the disk is running low.',
      'If you have not exported a backup in three weeks, you get a reminder to make one.',
      'The settings menu shows when you last made a backup.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-07-25',
    notes: [
      'Renamed from ColorNote Tabs to Noutieren. Your notes came along unchanged.',
      'Needs Firefox 142 or newer.',
      'Fixed the full-page button sometimes switching to an unrelated tab instead of opening its own.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-07-25',
    notes: [
      'First release: tabs with names and colours, formatted notes with checklists, search, autosave, and backups to a file.',
    ],
  },
];
