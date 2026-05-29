from playwright.sync_api import sync_playwright
import os

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    
    temp_dir = os.environ.get('TEMP', '/tmp')
    
    # 導入画面
    page.locator('button.secondary').click() # コースを観る (enters view mode, straight to terrain_loading)
    page.wait_for_timeout(1500) # wait for terrain loading (1000ms timeout)
    
    # Now in riding phase
    page.screenshot(path=os.path.join(temp_dir, 'step4_riding_layout.png'))
    
    print(f"Screenshots saved to {temp_dir}")
    browser.close()
