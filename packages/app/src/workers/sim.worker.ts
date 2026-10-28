/**
 * Simulation worker: runs @atc-app/sim off the UI thread and answers SimClient
 * requests posted from the scope (see services/simSession.ts).
 */
import { serveSimulation, type PortLike } from '@atc-app/sim';

// The app compiles against the DOM lib; a dedicated worker's global has the same
// postMessage / message-event surface as a Worker object.
const scope = self as unknown as Worker;

const port: PortLike = {
  postMessage: (data) => scope.postMessage(data),
  onMessage(listener) {
    const handler = (e: MessageEvent) => listener(e.data);
    scope.addEventListener('message', handler);
    return () => scope.removeEventListener('message', handler);
  },
};

serveSimulation(port);
