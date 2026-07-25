/**
 * Firefox MV3 background event page.
 *
 * Its only responsibility is making the toolbar button open the sidebar. There
 * is deliberately no default popup: a popup would swallow the click and make it
 * impossible to open the sidebar from the toolbar.
 *
 * `sidebarAction.open()` may only be called while handling a user action, so it
 * is invoked directly in the listener with no preceding `await`.
 */
const api = typeof browser !== 'undefined' ? browser : undefined;

if (api) {
  api.action.onClicked.addListener(() => {
    void api.sidebarAction.open();
  });
}
