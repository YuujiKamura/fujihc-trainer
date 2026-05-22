<script>
  import { rideStore } from '../stores/rideStore.svelte.js';
  
  // Props to control the position of the HUD over the 3D rider
  let { x = -1000, y = -1000 } = $props();
</script>

<div id="s-rider-hud" class="rider-hud" style="left: {x}px; top: {y}px; display: {x > -100 ? 'block' : 'none'};">
  <div class="ride-row"><b>slope</b> <span id="s-r-slope">{rideStore.slopePct.toFixed(1)}</span> %</div>
  <div class="ride-row"><b>speed</b> <span id="s-r-speed">{rideStore.speedKmh.toFixed(1)}</span></div>
  <div class="ride-row"><b>power</b> <span id="s-r-power">{rideStore.power || '--'}</span> W</div>
  <div class="ride-row"><b>cad</b>   <span id="s-r-cadence">{rideStore.cadence || '--'}</span> rpm</div>
  <div class="ride-row"><b>hr</b>    <span id="s-r-hr">{rideStore.hr || '--'}</span> bpm</div>
</div>

<style>
  .rider-hud {
    position: fixed; /* Fixed relative to viewport */
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 16px;
    font-family: sans-serif;
    transform: translate(-50%, 20px); /* Center horizontally, put slightly below the projected point */
    pointer-events: none;
    z-index: 1500;
  }
  .ride-row {
    margin: 2px 0;
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .ride-row b {
    color: #ffd54a;
    font-weight: normal;
  }
</style>
