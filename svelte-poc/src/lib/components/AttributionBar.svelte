<div class="attribution-bar">
  <div class="attribution-content">
    <span>© <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院</a></span>
    <span class="divider">|</span>
    <span>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</span>
  </div>
</div>

<style>
  .attribution-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 24px;
    background: var(--glass);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 var(--space-3);
    z-index: 1000;
    backdrop-filter: blur(4px);
    border-top: 1px solid var(--border);
  }

  .attribution-content {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--fs-micro);
    color: var(--text-faint);
  }

  .divider {
    color: var(--border-strong);
  }

  a {
    color: var(--text-muted);
    text-decoration: none;
    border-bottom: 1px dotted var(--border-strong);
    transition: color var(--dur-fast);
  }

  a:hover {
    color: var(--primary);
    border-bottom-style: solid;
  }
</style>
