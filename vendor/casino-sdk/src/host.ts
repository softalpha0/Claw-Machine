import { WindowMessenger, connect } from 'penpal';
import type { Connection } from 'penpal';
import type { GuestApiV1, HostApiV1 } from './types';

export type { GuestApiV1, HostApiV1, HostSnapshotV1 } from './types';

export type HostBridgeConnection = Connection<GuestApiV1>;

export const connectHostToGame = (options: {
  iframe: HTMLIFrameElement;
  childOrigin: string;
  methods: HostApiV1;
}): HostBridgeConnection => {
  const remoteWindow = options.iframe.contentWindow;
  if (!remoteWindow) {
    throw new Error('Iframe contentWindow is not available.');
  }

  return connect<GuestApiV1>({
    messenger: new WindowMessenger({
      remoteWindow,
      allowedOrigins: [options.childOrigin],
    }),
    methods: options.methods,
  });
};
