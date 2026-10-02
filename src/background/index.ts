import { installReminderHandlers } from './reminders';
import { installUpdateNotice } from '../services/whatsNew';

/**
 * Firefox MV3 background event page.
 *
 * The toolbar button opens the sidebar. There is deliberately no default popup:
 * a popup would swallow the click and make it impossible to open the sidebar
 * from the toolbar. `sidebarAction.open()` may only be called while handling a
 * user action, so there is no `await` before it.
 *
 * It also fires reminders, since nothing else is running when one is due, and
 * notes when Noutieren has been updated, for the "What's new" line.
 */
const api = typeof browser !== 'undefined' ? browser : undefined;

if (api) {
  api.action.onClicked.addListener(() => {
    void api.sidebarAction.open();
  });
  installReminderHandlers(api);
  installUpdateNotice(api);
}
