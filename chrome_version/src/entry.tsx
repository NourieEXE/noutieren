import { setTeardownHandoff } from '../../src/services/teardown';
import { mount } from '../../src/app/mount';
import { handOffToServiceWorker } from './teardownHandoff';

/**
 * Chrome entry point, shared by `popup.html` and `index.html`.
 *
 * The handoff is installed before the app mounts, so no editor can exist — and
 * therefore no keystroke can be queued — during a window where teardown would
 * still try to write in place.
 */
setTeardownHandoff(handOffToServiceWorker);
mount();
