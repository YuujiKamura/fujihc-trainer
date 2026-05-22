<script>
  import { rideStore } from '../stores/rideStore.svelte.js';
</script>

<div id="s-hud" class="hud">
  <b>time</b>  <span id="s-elapsed">{rideStore.formattedTime}</span><br>
  <b>dist</b>  <span id="s-dist">{Math.floor(rideStore.distMeters)}</span> / <span id="s-total">{Math.floor(rideStore.totalDistMeters)}</span> m<br>
  <b>ele</b>   <span id="s-ele">{Math.floor(rideStore.elevationMeters)}</span> m<br>
  <b>eta</b>   <span id="s-eta">{rideStore.formattedEta}</span><br>
  <b>ack</b>   <span id="s-ack" style="color:#aaa">{rideStore.ackStatus || 'trainer 応答待ち'}</span><br>
  <span style="color:#888; font-size:11px;">cam z=<span id="s-cam-zoom">{rideStore.cameraInfo.zoom}</span> p=<span id="s-cam-pitch">{rideStore.cameraInfo.pitch}</span>°</span>
</div>

<style>
  .hud {
    position: fixed;
    top: 10px;
    left: 10px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 10px;
    border-radius: 6px;
    font-family: monospace;
    font-size: 14px;
    line-height: 1.4;
    z-index: 1500;
    pointer-events: none; /* UIの裏側をクリックできるように */
  }
</style>
