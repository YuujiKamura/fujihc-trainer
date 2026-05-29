from playwright.sync_api import sync_playwright
import os

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    
    temp_dir = os.environ.get('TEMP', '/tmp')
    
    # Intro -> Setup
    page.locator('button.primary').click()
    page.wait_for_timeout(500)
    
    # Setup steps
    for _ in range(5):
        page.locator('button.action-btn').click()
        page.wait_for_timeout(500)
    
    # Wait for terrain loader to finish (1000ms in TerrainLoader.svelte)
    page.wait_for_timeout(1500)
    
    # Now in riding phase
    page.screenshot(path=os.path.join(temp_dir, 'step5_hud_panels.png'))
    
    print(f"Screenshots saved to {temp_dir}")
    browser.close()
