class RideStore {
  // Telemetry (live values)
  speedKmh = $state(0);
  power = $state(0);
  cadence = $state(0);
  hr = $state(0);
  slopePct = $state(0);
  
  // Progress
  distMeters = $state(0);
  totalDistMeters = $state(0);
  elevationMeters = $state(0);
  elapsedSeconds = $state(0);
  etaSeconds = $state(null);
  
  // States
  ackStatus = $state(''); // e.g. "trainer 応答待ち"
  cameraInfo = $state({ zoom: '--', pitch: '--' });
  
  // Formatted helpers
  get formattedTime() {
    const s = Math.floor(this.elapsedSeconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  get formattedEta() {
    if (this.etaSeconds === null || !isFinite(this.etaSeconds)) return '--';
    const hrs = Math.floor(this.etaSeconds / 3600);
    const mins = Math.floor((this.etaSeconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h${mins}m`;
    return `${mins}m`;
  }
}

export const rideStore = new RideStore();
