// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so the
// tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // Discovery: the devices of the location and its challenges.
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceUpdated((device) => app.deviceCreated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

  // Setpoints, on/off, brightness.
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // "Connect" (account_link): the Hilo sign-in page. No redirect comes back
  // to Gladys: the address of the last page is pasted in "Finish the sign-in".
  gladys.onOAuthAuthorizeUrl((key) => app.authorizeUrl(key));

  // Configuration screen buttons.
  gladys.onAction(ACTIONS.FINISH_SIGN_IN, (fields) => app.finishSignIn(fields));
  gladys.onAction(ACTIONS.TEST_CONNECTION, () => app.testConnection());
  gladys.onAction(ACTIONS.SIGN_OUT, () => app.signOut());

  // Configuration changed by the user.
  gladys.onConfigUpdated((config) => app.configUpdated(config));

  // Connection lifecycle: the first connection starts, a reconnection resends.
  gladys.on('connected', async () => {
    try {
      await app.connected(await gladys.getConfig());
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
}
