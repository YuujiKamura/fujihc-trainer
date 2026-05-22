import { createTestModeClient, createFakeStateGenerator } from '../../lib/ws_client.js';
import { rideStore } from './rideStore.svelte.js';

class BleStore {
  ready = $state(false);
  client = null;
  
  init() {
    const wsHandlers = {
      state: (msg) => {
        // This is called by the test mode client (or BLE client) with { power, cadence, hr, speed, slope_pct }
        rideStore.power = msg.power || 0;
        rideStore.cadence = msg.cadence || 0;
        rideStore.hr = msg.hr || 0;
        if (msg.speed !== undefined) rideStore.speedKmh = msg.speed * 3.6;
      },
      connect_status: (status) => {
        if (status === 'connected') {
          this.ready = true;
          rideStore.ackStatus = 'trainer 接続済';
        }
      },
      log: (msg) => {
        console.log('[bleStore]', msg);
      }
    };

    // Use fake test client for Svelte standalone map for now
    this.client = createTestModeClient(wsHandlers, {
      fakeStateInterval: 1000,
      fakeStateGenerator: createFakeStateGenerator(() => null, 'OK (SVELTE MODE)')
    });
    
    // Simulate immediate connection since it's test mode
    setTimeout(() => {
      wsHandlers.connect_status('connected');
    }, 500);
  }

  startRide() {
    if (this.client) {
      this.client.sendStartRide();
      rideStore.ackStatus = '走行中';
    }
  }
}

export const bleStore = new BleStore();
