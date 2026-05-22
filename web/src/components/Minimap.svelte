<script>
</script>

<div id="s-minimap-container" class="minimap-container">
  <canvas id="s-minimap-top" width="320" height="561"></canvas>
  <canvas id="s-minimap-bottom" width="320" height="159"></canvas>
</div>

<style>
  .minimap-container {
    position: fixed;
    right: 10px;
    bottom: 10px;
    width: 320px;
    display: flex;
    flex-direction: column;
    gap: 0;
    z-index: 1500;
    pointer-events: none;
    background: rgba(0,0,0,0.4);
    border-radius: 4px;
    overflow: hidden;
  }
  canvas {
    display: block;
    width: 100%;
  }
  #s-minimap-bottom {
    background: rgba(20, 30, 30, 0.9);
  }
</style>
